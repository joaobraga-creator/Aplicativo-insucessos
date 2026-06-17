# Ferramentas NEX Nodo MLB

Este servico tem duas partes:

- `GET /api/insucessos-nex-mlb`: endpoint seguro para o Grid consumir BigQuery usando service account.
- `/`: aplicativo mobile para o nodo escanear pacotes, coletar assinatura do motorista e salvar a conferencia no BigQuery.

## Como rodar

Configure a chave da service account fora do HTML/Grid:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS="C:\caminho\para\service-account.json"
$env:BQ_PROJECT_ID="meli-bi-data"
$env:BQ_SCAN_TABLE="meli-bi-data.SBOX_MLBPLACES.nodo_package_conferences"
npm install
npm start
```

Endpoints:

```text
GET /api/insucessos-nex-mlb
POST /api/nodo-conferences
```

Antes de usar o app de conferencia, crie a tabela:

```powershell
bq --project_id=meli-bi-data query --location=US --use_legacy_sql=false < bigquery_nodo_package_conferences.sql
```

O app aceita scanner fisico como teclado no campo de leitura. Em celulares compativeis, o botao Camera usa a API nativa do navegador para ler codigo de barras.

A chave nunca deve ir para HTML, Grid ou frontend. O BigQuery e acessado somente pelo servidor.

## Deploy no Render

O arquivo `render.yaml` descreve um Web Service Docker, mas o Render fica fora do ambiente Google/MELI. Se o BigQuery estiver protegido por VPC Service Controls, o endpoint de salvamento retornara:

```text
Request is prohibited by organization's policy
```

Nesse caso, use Cloud Run/Fury dentro do ambiente permitido. Render pode servir a tela, mas nao deve ser usado para gravar no BigQuery protegido.

Se ainda for usado em um ambiente sem VPC Service Controls, configure a credencial do Google de uma destas formas:

- `GOOGLE_APPLICATION_CREDENTIALS` apontando para um arquivo de chave montado como Secret File.
- Ou `GOOGLE_APPLICATION_CREDENTIALS_JSON` se voce adaptar o start para materializar a chave antes de subir o Node.

Variaveis esperadas:

```text
BQ_PROJECT_ID=meli-bi-data
BQ_LOCATION=US
BQ_SCAN_TABLE=meli-bi-data.SBOX_MLBPLACES.nodo_package_conferences
```

## Deploy recomendado em GCP

O melhor deploy para GCP e Cloud Run usando a service account como identidade do servico, sem arquivo de chave:

```powershell
.\deploy-cloud-run.ps1
```

Se o projeto ainda nao estiver habilitado, um admin precisa liberar:

- `serviceusage.googleapis.com`
- `run.googleapis.com`
- `cloudbuild.googleapis.com`
- `artifactregistry.googleapis.com`

Permissoes necessarias para deploy:

- Cloud Run Admin no projeto de deploy
- Service Account User na service account `gestao-nodos-mlb@bidata-cross-sa-batch.iam.gserviceaccount.com`
- Permissao para habilitar APIs ou APIs ja habilitadas previamente
