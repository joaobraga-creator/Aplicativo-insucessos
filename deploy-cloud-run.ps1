param(
  [string]$ProjectId = "bidata-cross-sa-batch",
  [string]$Region = "us-east1",
  [string]$ServiceName = "nex-insucessos-grid-api",
  [string]$RuntimeServiceAccount = "gestao-nodos-mlb@bidata-cross-sa-batch.iam.gserviceaccount.com"
)

$ErrorActionPreference = "Stop"

gcloud services enable `
  run.googleapis.com `
  cloudbuild.googleapis.com `
  artifactregistry.googleapis.com `
  --project=$ProjectId `
  --quiet

gcloud run deploy $ServiceName `
  --source . `
  --project=$ProjectId `
  --region=$Region `
  --service-account=$RuntimeServiceAccount `
  --allow-unauthenticated `
  --set-env-vars="BQ_PROJECT_ID=meli-bi-data,BQ_LOCATION=US,CACHE_TTL_SECONDS=300" `
  --quiet
