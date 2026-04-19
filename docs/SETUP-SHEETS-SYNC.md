# Setup: Sync Firestore → Google Sheets

## 1. Habilitar a Google Sheets API

1. Acesse [console.cloud.google.com/apis/library/sheets.googleapis.com?project=gestao-financeira-799e6](https://console.cloud.google.com/apis/library/sheets.googleapis.com?project=gestao-financeira-799e6)
2. Clique em **Habilitar**

---

## 2. Criar o Secret no Secret Manager ✅ (concluído)

1. Acesse [console.cloud.google.com/security/secret-manager?project=gestao-financeira-799e6](https://console.cloud.google.com/security/secret-manager?project=gestao-financeira-799e6)
2. Clique em **Criar secret**
3. Nome: `SHEETS_SERVICE_ACCOUNT`
4. Abra o arquivo `serviceAccountKey.json`, copie todo o conteúdo e cole no campo **Valor do secret**
5. Clique em **Criar secret**

---

## 3. Conceder acesso ao Secret Manager para o Cloud Functions

1. Acesse [console.cloud.google.com/iam-admin/iam?project=gestao-financeira-799e6](https://console.cloud.google.com/iam-admin/iam?project=gestao-financeira-799e6)
2. Localize o membro `firebase-adminsdk-fbsvc@gestao-financeira-799e6.iam.gserviceaccount.com`
3. Clique no ícone de lápis (Editar)
4. Clique em **+ Adicionar outro papel**
5. Busque e selecione **Acessador de secrets do Secret Manager**
6. Clique em **Salvar**

---

## 4. Compartilhar a Planilha com a Service Account

1. Abra a planilha no Google Sheets
2. Clique em **Compartilhar**
3. Adicione o e-mail abaixo como **Editor**:

```
firebase-adminsdk-fbsvc@gestao-financeira-799e6.iam.gserviceaccount.com
```

---

## 5. Obter o ID da Planilha

Na URL da planilha: 1ZpHYBFJpuDb-C0z52NvqchWq7PHii8iexdwgngRbIFo

```
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

Copie o trecho entre `/d/` e `/edit` — esse é o `spreadsheetId`.

---

## 6. Configurar a Empresa no Firestore

1. Acesse o [Firebase Console](https://console.firebase.google.com/project/gestao-financeira-799e6/firestore)
2. Navegue até a coleção `companies`
3. Abra o documento da sua empresa
4. Adicione o campo abaixo (tipo **map**):

```
sheetsSync
  ├── spreadsheetId  (string)  →  cole o ID do passo 5
  └── sheetName      (string)  →  nome exato da aba (ex: "Transações")
```

---

## 7. Adicionar a Linha de Cabeçalho na Planilha (se ainda não tiver)

Certifique-se de que a **linha 1** da aba configurada contém exatamente estes cabeçalhos, nesta ordem:

| A     | B       | C          | D         | E         | F    | G   | H   | I           | J         | K     | L     | M     | N   |
| ----- | ------- | ---------- | --------- | --------- | ---- | --- | --- | ----------- | --------- | ----- | ----- | ----- | --- |
| LANÇ. | VÍNCULO | FAVORECIDO | DESCRIÇÃO | CATEGORIA | TIPO | MÊS | ANO | DATA DE PGT | N DA PARC | VALOR | TOTAL | EFTVD | ID  |

A coluna **N (ID)** pode ser ocultada após criar o cabeçalho: clique com o botão direito na coluna → **Ocultar coluna**.

---

Após concluir esses passos, avise para prosseguirmos com a implementação do código.
