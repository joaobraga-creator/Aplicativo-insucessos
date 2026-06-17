WITH carteira AS (
  SELECT
    UPPER(TRIM(PLC_PLACE_SVC)) AS svc,
    UPPER(TRIM(PLC_PLACE_FACILITY)) AS facility_node,
    ANY_VALUE(UPPER(TRIM(PLC_PLACE_SUBREGIONAL))) AS subregional
  FROM `meli-bi-data.WHOWNER.BT_CARTEIRA_MLB`
  WHERE PLC_PLACE_SVC IS NOT NULL OR PLC_PLACE_FACILITY IS NOT NULL
  GROUP BY 1, 2
),
base AS (
  SELECT
    COALESCE(
      LM_PUS_AUTHDPU,
      LM_PUS_FD_ROUTED,
      LM_PUS_DT_FROM,
      SHP_LG_INIT_DT_TZ,
      DATE(SHP_LG_SCAN_DTTM_TZ),
      DATE(AUD_UPD_DTTM),
      DATE(AUD_INS_DTTM)
    ) AS data_base,
    SHP_SHIPMENT_ID AS shipment_id,
    UPPER(TRIM(SHP_SITE_ID)) AS site_id,
    UPPER(TRIM(LM_PUS_SUB_TYPE)) AS sub_type,
    UPPER(TRIM(LM_PUS_TYPE)) AS lm_pus_type,
    UPPER(TRIM(LM_PUS_FINAL_STATUS)) AS final_status,
    UPPER(TRIM(SHP_NODE_ID_TYPE)) AS node_id_type,
    UPPER(TRIM(SHP_LG_FACILITY_ID)) AS svc,
    UPPER(TRIM(SHP_NODE_ID)) AS facility_node,
    UPPER(TRIM(CAST(SHP_LG_ROUTE_ID AS STRING))) AS route_id,
    CAST(NULL AS STRING) AS route_status,
    CAST(NULL AS STRING) AS driver_id,
    UPPER(TRIM(SHP_LG_DRIVER_USER_ID_LOYALTY)) AS driver_experience,
    UPPER(TRIM(SHP_LG_VEHICLE_PLATE_ID)) AS vehicle_plate,
    UPPER(TRIM(SHP_LG_VEHICLE_TYPE)) AS vehicle_type,
    UPPER(TRIM(SHP_COMPANY_NAME)) AS transportadora,
    UPPER(TRIM(SHP_LG_TRANSPORT_UNIT_STATUS)) AS transport_unit_status,
    CAST(SHP_ORDER_COST_USD AS NUMERIC) AS valor_usd,
    PUS_LM_IS_COLLECTED AS is_collected
  FROM `meli-bi-data.WHOWNER.BT_SHP_SHIPMENTS_LAST_MILE_PICKUP`
  WHERE SHP_SITE_ID = 'MLB'
    AND LM_PUS_SUB_TYPE = 'NEX'
    AND LM_PUS_TYPE = 'FALLIDO DC / NEX'
    AND SHP_NODE_ID_TYPE = 'NEX'
    AND SHP_SHIPMENT_ID IS NOT NULL
    AND COALESCE(PUS_LM_IS_COLLECTED, 0) = 0
    AND COALESCE(
      LM_PUS_AUTHDPU,
      LM_PUS_FD_ROUTED,
      LM_PUS_DT_FROM,
      SHP_LG_INIT_DT_TZ,
      DATE(SHP_LG_SCAN_DTTM_TZ),
      DATE(AUD_UPD_DTTM),
      DATE(AUD_INS_DTTM)
    ) BETWEEN DATE '2026-01-01' AND DATE '2026-12-31'
),
classificado AS (
  SELECT
    b.*,
    COALESCE(c1.subregional, c2.subregional, 'SEM_SUBREGIONAL') AS subregional,
    DATE_DIFF(CURRENT_DATE('America/Sao_Paulo'), data_base, DAY) AS aging_dias,
    CASE
      WHEN route_id IS NOT NULL THEN 'COM_MOTORISTA'
      ELSE 'NO_NODO'
    END AS local_pacote,
    CASE
      WHEN route_id IS NOT NULL THEN 'TIPO_2_PLACE_PARA_SVC'
      ELSE 'PARADO_NO_NODO_PLACE'
    END AS fluxo_motorista
  FROM base b
  LEFT JOIN carteira c1
    ON c1.svc = b.svc
  LEFT JOIN carteira c2
    ON c2.facility_node = b.facility_node
),
dedup AS (
  SELECT
    local_pacote,
    fluxo_motorista,
    data_base,
    aging_dias,
    shipment_id,
    subregional,
    svc,
    facility_node,
    lm_pus_type,
    final_status,
    route_id,
    route_status,
    driver_id,
    driver_experience,
    vehicle_plate,
    vehicle_type,
    transportadora,
    transport_unit_status,
    valor_usd,
    CASE
      WHEN local_pacote = 'COM_MOTORISTA' THEN 'Acionar motorista/transportadora para devolucao ao SVC'
      ELSE 'Validar pacote fisico no nodo/place e direcionar devolucao NEX'
    END AS acao
  FROM classificado
  WHERE local_pacote IN ('NO_NODO', 'COM_MOTORISTA')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY shipment_id
    ORDER BY data_base DESC, IF(local_pacote = 'COM_MOTORISTA', 0, 1)
  ) = 1
),
metricas AS (
  SELECT
    COUNT(*) AS total_pacotes,
    COUNTIF(local_pacote = 'NO_NODO') AS total_no_nodo,
    COUNTIF(local_pacote = 'COM_MOTORISTA') AS total_com_motorista,
    MAX(aging_dias) AS total_maior_aging,
    SUM(COALESCE(valor_usd, 0)) AS total_valor_usd,
    COUNTIF(aging_dias > 60) AS total_acima_60,
    COUNTIF(aging_dias > 90) AS total_acima_90
  FROM dedup
),
summaries AS (
  SELECT
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT subregional AS label, COUNT(*) AS value
      FROM dedup
      GROUP BY 1
    )) AS summary_subregional,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT svc AS label, COUNT(*) AS value
      FROM dedup
      GROUP BY 1
    )) AS summary_svc,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT facility_node AS label, COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'NO_NODO'
      GROUP BY 1
    )) AS summary_facility,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT transportadora AS label, COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'COM_MOTORISTA'
      GROUP BY 1
    )) AS summary_transportadora,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT vehicle_plate AS label, COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'COM_MOTORISTA'
      GROUP BY 1
    )) AS summary_placa,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT
        subregional,
        svc,
        local_pacote,
        COUNT(*) AS pacotes,
        SUM(COALESCE(valor_usd, 0)) AS valor_usd,
        MAX(aging_dias) AS maior_aging
      FROM dedup
      GROUP BY 1, 2, 3
    )) AS summary_cube
    ,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT
        subregional,
        svc,
        facility_node AS label,
        COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'NO_NODO'
      GROUP BY 1, 2, 3
    )) AS summary_facility_cube,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT
        subregional,
        svc,
        transportadora AS label,
        COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'COM_MOTORISTA'
      GROUP BY 1, 2, 3
    )) AS summary_transportadora_cube,
    TO_JSON_STRING(ARRAY(
      SELECT AS STRUCT
        subregional,
        svc,
        vehicle_plate AS label,
        COUNT(*) AS value
      FROM dedup
      WHERE local_pacote = 'COM_MOTORISTA'
      GROUP BY 1, 2, 3
      LIMIT 5000
    )) AS summary_placa_cube
)
SELECT
  FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', CURRENT_TIMESTAMP(), 'America/Sao_Paulo') AS updated_at,
  m.*,
  s.*,
  '[]' AS detail_rows
FROM metricas m
CROSS JOIN summaries s
LIMIT 50000;
