CREATE TABLE IF NOT EXISTS `meli-bi-data.nex_operacao.nodo_package_conferences` (
  session_id STRING NOT NULL,
  shipment_id STRING NOT NULL,
  scan_sequence INT64,
  scanned_at TIMESTAMP,
  signed_at TIMESTAMP,
  nodo_place STRING,
  driver_name STRING,
  driver_document STRING,
  driver_plate STRING,
  carrier STRING,
  route_id STRING,
  operator_name STRING,
  notes STRING,
  signature_png STRING,
  source_app STRING,
  user_agent STRING
)
PARTITION BY DATE(signed_at)
CLUSTER BY nodo_place, driver_plate, shipment_id;
