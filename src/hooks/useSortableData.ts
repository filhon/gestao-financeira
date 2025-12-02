import { useState, useMemo } from 'react';

type SortConfig<T> = {
    key: keyof T | string;
    direction: 'asc' | 'desc';
} | null;

export const useSortableData = <T>(items: T[], config: SortConfig<T> = null) => {
    const [sortConfig, setSortConfig] = useState<SortConfig<T>>(config);

    const sortedItems = useMemo(() => {
        let sortableItems = [...items];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                // Handle nested properties if key is a string with dots (e.g. "category.name")
                const getValue = (item: T, path: string | keyof T) => {
                    if (typeof path === 'string' && path.includes('.')) {
                        return path.split('.').reduce((obj: any, key) => obj?.[key], item);
                    }
                    return item[path as keyof T];
                };

                const aValue = getValue(a, sortConfig.key);
                const bValue = getValue(b, sortConfig.key);

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [items, sortConfig]);

    const requestSort = (key: keyof T | string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (
            sortConfig &&
            sortConfig.key === key &&
            sortConfig.direction === 'asc'
        ) {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    return { items: sortedItems, requestSort, sortConfig };
};
