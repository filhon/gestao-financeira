"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Upload, Download, FileSpreadsheet, Loader2, AlertCircle, CheckCircle2, Trash2, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { importService } from "@/lib/services/importService";
import { costCenterService } from "@/lib/services/costCenterService";
import { ImportedRow, ImportStep, ImportResult } from "@/lib/types/importTypes";
import { CostCenter } from "@/lib/types";
import { useAuth } from "@/components/providers/AuthProvider";
import { useCompany } from "@/components/providers/CompanyProvider";

interface BulkImportDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
    type: "payable" | "receivable";
}

export function BulkImportDialog({ isOpen, onClose, onSuccess, type }: BulkImportDialogProps) {
    const { user } = useAuth();
    const { selectedCompany } = useCompany();
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // State
    const [step, setStep] = useState<ImportStep>('upload');
    const [rows, setRows] = useState<ImportedRow[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
    const [defaultCostCenterId, setDefaultCostCenterId] = useState<string>('');
    const [bulkCostCenterId, setBulkCostCenterId] = useState<string>('');
    const [progress, setProgress] = useState(0);
    const [result, setResult] = useState<ImportResult | null>(null);
    const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    
    // Load cost centers
    useEffect(() => {
        const loadCostCenters = async () => {
            if (selectedCompany) {
                try {
                    const data = await costCenterService.getAll(selectedCompany.id);
                    setCostCenters(data);
                } catch (error) {
                    console.error('Error loading cost centers:', error);
                }
            }
        };
        if (isOpen) {
            loadCostCenters();
        }
    }, [selectedCompany, isOpen]);
    
    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setStep('upload');
            setRows([]);
            setSelectedIds(new Set());
            setDefaultCostCenterId('');
            setBulkCostCenterId('');
            setProgress(0);
            setResult(null);
            setEditingCell(null);
        }
    }, [isOpen]);
    
    // Drag and drop handlers
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);
    
    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
    }, []);
    
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) processFile(file);
    }, []);
    
    // File processing
    const processFile = async (file: File) => {
        const validTypes = [
            'text/csv',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ];
        
        const isValidExtension = file.name.endsWith('.csv') || 
                                 file.name.endsWith('.xls') || 
                                 file.name.endsWith('.xlsx');
        
        if (!validTypes.includes(file.type) && !isValidExtension) {
            toast.error('Formato de arquivo não suportado. Use CSV ou Excel.');
            return;
        }
        
        setStep('processing');
        setProgress(0);
        
        try {
            // Simulate progress for UX
            const progressInterval = setInterval(() => {
                setProgress(prev => Math.min(prev + 10, 80));
            }, 100);
            
            const parsed = await importService.parseFile(file);
            
            clearInterval(progressInterval);
            setProgress(100);
            
            // Validate rows
            let validatedRows = importService.validateRows(parsed, costCenters);
            
            // Apply default cost center if set
            if (defaultCostCenterId) {
                validatedRows = importService.applyDefaultCostCenter(validatedRows, defaultCostCenterId);
                validatedRows = importService.validateRows(validatedRows, costCenters);
            }
            
            setRows(validatedRows);
            
            setTimeout(() => {
                setStep('preview');
            }, 300);
            
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Erro ao processar arquivo');
            setStep('upload');
        }
    };
    
    // Handle file input change
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) processFile(file);
    };
    
    // Download template
    const handleDownloadTemplate = () => {
        importService.generateTemplate(type);
        toast.success('Modelo baixado com sucesso!');
    };
    
    // Selection handlers
    const toggleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(rows.map(r => r.id)));
        } else {
            setSelectedIds(new Set());
        }
    };
    
    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            newSelected.delete(id);
        } else {
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };
    
    // Bulk actions
    const handleApplyCostCenterToSelected = () => {
        if (!bulkCostCenterId || selectedIds.size === 0) return;
        
        let updated = importService.applyCostCenterToSelected(rows, selectedIds, bulkCostCenterId);
        updated = importService.validateRows(updated, costCenters);
        setRows(updated);
        setSelectedIds(new Set());
        setBulkCostCenterId('');
        toast.success(`Centro de custo aplicado a ${selectedIds.size} linha(s)`);
    };
    
    const handleDeleteSelected = () => {
        setRows(rows.filter(r => !selectedIds.has(r.id)));
        setSelectedIds(new Set());
        toast.success('Linhas removidas');
    };
    
    // Inline editing
    const startEdit = (id: string, field: string, currentValue: string | number | undefined) => {
        setEditingCell({ id, field });
        setEditValue(currentValue?.toString() || '');
    };
    
    const saveEdit = () => {
        if (!editingCell) return;
        
        setRows(prevRows => {
            const updated = prevRows.map(row => {
                if (row.id === editingCell.id) {
                    return { 
                        ...row, 
                        [editingCell.field]: editValue 
                    };
                }
                return row;
            });
            return importService.validateRows(updated, costCenters);
        });
        
        setEditingCell(null);
        setEditValue('');
    };
    
    const cancelEdit = () => {
        setEditingCell(null);
        setEditValue('');
    };
    
    // Cost center change per row
    const handleRowCostCenterChange = (rowId: string, costCenterId: string) => {
        let updated = rows.map(row => {
            if (row.id === rowId) {
                return { 
                    ...row, 
                    costCenterId,
                    warnings: row.warnings.filter(w => w.field !== 'costCenterCode')
                };
            }
            return row;
        });
        updated = importService.validateRows(updated, costCenters);
        setRows(updated);
    };
    
    // Import confirmation
    const handleConfirmImport = async () => {
        if (!user || !selectedCompany) return;
        
        const validRows = rows.filter(r => r.isValid && r.costCenterId);
        if (validRows.length === 0) {
            toast.error('Nenhuma linha válida para importar');
            return;
        }
        
        setStep('importing');
        setProgress(0);
        
        try {
            const importResult = await importService.createTransactions(
                validRows,
                type,
                { uid: user.uid, email: user.email },
                selectedCompany.id,
                (current, total) => {
                    setProgress(Math.round((current / total) * 100));
                }
            );
            
            setResult(importResult);
            setStep('result');
            
            if (importResult.success > 0) {
                onSuccess();
            }
        } catch (error) {
            toast.error('Erro durante a importação');
            setStep('preview');
        }
    };
    
    // Computed values
    const validCount = rows.filter(r => r.isValid && r.costCenterId).length;
    const errorCount = rows.filter(r => !r.isValid).length;
    const warningCount = rows.filter(r => r.isValid && !r.costCenterId).length;
    
    // Render helpers
    const renderUploadStep = () => (
        <div className="space-y-6 py-4">
            {/* Default cost center selector */}
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex-1">
                    <label className="text-sm font-medium">Centro de Custo Padrão</label>
                    <p className="text-xs text-muted-foreground">
                        Será aplicado automaticamente às linhas sem centro de custo
                    </p>
                </div>
                <Select value={defaultCostCenterId} onValueChange={setDefaultCostCenterId}>
                    <SelectTrigger className="w-[250px]">
                        <SelectValue placeholder="Selecione (opcional)" />
                    </SelectTrigger>
                    <SelectContent>
                        {costCenters.map(cc => (
                            <SelectItem key={cc.id} value={cc.id}>
                                {cc.code} - {cc.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            
            {/* Drag and drop area */}
            <div
                className={cn(
                    "border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer",
                    isDragOver 
                        ? "border-primary bg-primary/5" 
                        : "border-muted-foreground/25 hover:border-primary/50"
                )}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    className="hidden"
                    onChange={handleFileChange}
                />
                <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-lg font-medium mb-1">
                    Arraste um arquivo ou clique para selecionar
                </p>
                <p className="text-sm text-muted-foreground">
                    Formatos aceitos: CSV, XLS, XLSX
                </p>
            </div>
            
            {/* Download template */}
            <div className="flex justify-center">
                <Button variant="outline" onClick={handleDownloadTemplate}>
                    <Download className="mr-2 h-4 w-4" />
                    Baixar Modelo de Planilha
                </Button>
            </div>
        </div>
    );
    
    const renderProcessingStep = () => (
        <div className="py-12 space-y-6 text-center">
            <FileSpreadsheet className="mx-auto h-16 w-16 text-primary animate-pulse" />
            <div>
                <p className="text-lg font-medium mb-2">Processando arquivo...</p>
                <p className="text-sm text-muted-foreground">
                    Lendo e validando dados da planilha
                </p>
            </div>
            <Progress value={progress} className="w-full max-w-md mx-auto" />
        </div>
    );
    
    const renderPreviewStep = () => (
        <div className="space-y-4">
            {/* Stats bar */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex gap-4">
                    <Badge variant="outline" className="gap-1">
                        Total: {rows.length}
                    </Badge>
                    <Badge className="bg-emerald-500 gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Válidos: {validCount}
                    </Badge>
                    {errorCount > 0 && (
                        <Badge className="bg-red-500 gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Erros: {errorCount}
                        </Badge>
                    )}
                    {warningCount > 0 && (
                        <Badge className="bg-amber-500 gap-1">
                            <AlertCircle className="h-3 w-3" />
                            Sem CC: {warningCount}
                        </Badge>
                    )}
                </div>
            </div>
            
            {/* Bulk actions bar */}
            <div className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
                <div className="flex items-center gap-2">
                    <Select value={bulkCostCenterId} onValueChange={setBulkCostCenterId}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Centro de Custo" />
                        </SelectTrigger>
                        <SelectContent>
                            {costCenters.map(cc => (
                                <SelectItem key={cc.id} value={cc.id}>
                                    {cc.code} - {cc.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button 
                        size="sm" 
                        variant="secondary"
                        onClick={handleApplyCostCenterToSelected}
                        disabled={!bulkCostCenterId || selectedIds.size === 0}
                    >
                        Aplicar ({selectedIds.size})
                    </Button>
                </div>
                
                <div className="flex-1" />
                
                {selectedIds.size > 0 && (
                    <Button 
                        size="sm" 
                        variant="destructive"
                        onClick={handleDeleteSelected}
                    >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Excluir ({selectedIds.size})
                    </Button>
                )}
            </div>
            
            {/* Data table */}
            <ScrollArea className="h-[400px] rounded-md border">
                <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={rows.length > 0 && selectedIds.size === rows.length}
                                    onCheckedChange={toggleSelectAll}
                                />
                            </TableHead>
                            <TableHead className="w-[50px]">#</TableHead>
                            <TableHead>Descrição</TableHead>
                            <TableHead>Valor</TableHead>
                            <TableHead>Vencimento</TableHead>
                            <TableHead>{type === 'payable' ? 'Fornecedor' : 'Cliente'}</TableHead>
                            <TableHead>Centro de Custo</TableHead>
                            <TableHead className="w-[100px]">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {rows.map(row => {
                            const hasError = !row.isValid;
                            const hasWarning = row.isValid && row.warnings.length > 0;
                            const costCenter = costCenters.find(cc => cc.id === row.costCenterId);
                            
                            return (
                                <TableRow 
                                    key={row.id}
                                    className={cn(
                                        hasError && "bg-red-500/10",
                                        hasWarning && !hasError && "bg-amber-500/10"
                                    )}
                                >
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedIds.has(row.id)}
                                            onCheckedChange={() => toggleSelect(row.id)}
                                        />
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {row.rowNumber}
                                    </TableCell>
                                    <TableCell>
                                        {editingCell?.id === row.id && editingCell.field === 'description' ? (
                                            <Input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={saveEdit}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') saveEdit();
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="h-7"
                                            />
                                        ) : (
                                            <span 
                                                className={cn(
                                                    "cursor-pointer hover:bg-muted px-1 rounded",
                                                    row.errors.some(e => e.field === 'description') && "text-red-500"
                                                )}
                                                onClick={() => startEdit(row.id, 'description', row.description)}
                                            >
                                                {row.description || '-'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingCell?.id === row.id && editingCell.field === 'amount' ? (
                                            <Input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={saveEdit}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') saveEdit();
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="h-7 w-24"
                                            />
                                        ) : (
                                            <span 
                                                className={cn(
                                                    "cursor-pointer hover:bg-muted px-1 rounded",
                                                    row.errors.some(e => e.field === 'amount') && "text-red-500"
                                                )}
                                                onClick={() => startEdit(row.id, 'amount', row.amount)}
                                            >
                                                {row.amount || '-'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingCell?.id === row.id && editingCell.field === 'dueDate' ? (
                                            <Input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={saveEdit}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') saveEdit();
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="h-7 w-28"
                                                placeholder="dd/mm/aaaa"
                                            />
                                        ) : (
                                            <span 
                                                className={cn(
                                                    "cursor-pointer hover:bg-muted px-1 rounded",
                                                    row.errors.some(e => e.field === 'dueDate') && "text-red-500"
                                                )}
                                                onClick={() => startEdit(row.id, 'dueDate', row.dueDate)}
                                            >
                                                {row.dueDate || '-'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {editingCell?.id === row.id && editingCell.field === 'supplierOrClient' ? (
                                            <Input
                                                value={editValue}
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={saveEdit}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') saveEdit();
                                                    if (e.key === 'Escape') cancelEdit();
                                                }}
                                                autoFocus
                                                className="h-7"
                                            />
                                        ) : (
                                            <span 
                                                className={cn(
                                                    "cursor-pointer hover:bg-muted px-1 rounded",
                                                    row.errors.some(e => e.field === 'supplierOrClient') && "text-red-500"
                                                )}
                                                onClick={() => startEdit(row.id, 'supplierOrClient', row.supplierOrClient)}
                                            >
                                                {row.supplierOrClient || '-'}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Select 
                                            value={row.costCenterId || ''} 
                                            onValueChange={(v) => handleRowCostCenterChange(row.id, v)}
                                        >
                                            <SelectTrigger className={cn(
                                                "h-7 w-[140px]",
                                                !row.costCenterId && "border-amber-500"
                                            )}>
                                                <SelectValue placeholder="Selecione" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {costCenters.map(cc => (
                                                    <SelectItem key={cc.id} value={cc.id}>
                                                        {cc.code}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        {hasError ? (
                                            <div className="flex items-center gap-1 text-red-500" title={row.errors.map(e => e.message).join(', ')}>
                                                <AlertCircle className="h-4 w-4" />
                                                <span className="text-xs">Erro</span>
                                            </div>
                                        ) : hasWarning ? (
                                            <div className="flex items-center gap-1 text-amber-500" title={row.warnings.map(w => w.message).join(', ')}>
                                                <AlertCircle className="h-4 w-4" />
                                                <span className="text-xs">Aviso</span>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 text-emerald-500">
                                                <CheckCircle2 className="h-4 w-4" />
                                                <span className="text-xs">OK</span>
                                            </div>
                                        )}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                </Table>
            </ScrollArea>
            
            {/* Action buttons */}
            <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={() => setStep('upload')}>
                    Voltar
                </Button>
                <Button 
                    onClick={handleConfirmImport}
                    disabled={validCount === 0}
                >
                    Confirmar Importação ({validCount} {validCount === 1 ? 'item' : 'itens'})
                </Button>
            </div>
        </div>
    );
    
    const renderImportingStep = () => (
        <div className="py-12 space-y-6 text-center">
            <Loader2 className="mx-auto h-16 w-16 text-primary animate-spin" />
            <div>
                <p className="text-lg font-medium mb-2">Importando transações...</p>
                <p className="text-sm text-muted-foreground">
                    Criando {validCount} {type === 'payable' ? 'contas a pagar' : 'contas a receber'}
                </p>
            </div>
            <Progress value={progress} className="w-full max-w-md mx-auto" />
            <p className="text-sm text-muted-foreground">{progress}%</p>
        </div>
    );
    
    const renderResultStep = () => (
        <div className="py-8 space-y-6 text-center">
            {result && result.success > 0 ? (
                <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
            ) : (
                <AlertCircle className="mx-auto h-16 w-16 text-red-500" />
            )}
            
            <div>
                <p className="text-xl font-semibold mb-2">Importação Concluída</p>
                <div className="flex justify-center gap-6 mt-4">
                    <div className="text-center">
                        <p className="text-3xl font-bold text-emerald-500">{result?.success || 0}</p>
                        <p className="text-sm text-muted-foreground">Importados</p>
                    </div>
                    {result && result.failed > 0 && (
                        <div className="text-center">
                            <p className="text-3xl font-bold text-red-500">{result.failed}</p>
                            <p className="text-sm text-muted-foreground">Falharam</p>
                        </div>
                    )}
                </div>
            </div>
            
            {result?.errors && result.errors.length > 0 && (
                <div className="text-left bg-red-500/10 rounded-lg p-4 max-w-md mx-auto">
                    <p className="text-sm font-medium text-red-500 mb-2">Erros encontrados:</p>
                    <ul className="text-sm space-y-1">
                        {result.errors.slice(0, 5).map((err, i) => (
                            <li key={i} className="text-muted-foreground">
                                Linha {err.row}: {err.message}
                            </li>
                        ))}
                        {result.errors.length > 5 && (
                            <li className="text-muted-foreground">
                                ... e mais {result.errors.length - 5} erro(s)
                            </li>
                        )}
                    </ul>
                </div>
            )}
            
            <Button onClick={onClose}>Fechar</Button>
        </div>
    );
    
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[90vw] max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <FileSpreadsheet className="h-5 w-5" />
                        Importar {type === 'payable' ? 'Contas a Pagar' : 'Contas a Receber'}
                    </DialogTitle>
                    <DialogDescription>
                        {step === 'upload' && 'Faça upload de um arquivo CSV ou Excel com as transações'}
                        {step === 'processing' && 'Processando arquivo...'}
                        {step === 'preview' && 'Revise os dados antes de confirmar a importação'}
                        {step === 'importing' && 'Importando transações...'}
                        {step === 'result' && 'Resultado da importação'}
                    </DialogDescription>
                </DialogHeader>
                
                <div className="flex-1 overflow-auto">
                    {step === 'upload' && renderUploadStep()}
                    {step === 'processing' && renderProcessingStep()}
                    {step === 'preview' && renderPreviewStep()}
                    {step === 'importing' && renderImportingStep()}
                    {step === 'result' && renderResultStep()}
                </div>
            </DialogContent>
        </Dialog>
    );
}
