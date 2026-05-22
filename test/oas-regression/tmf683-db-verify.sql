\pset pager off
\pset null '<null>'

SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
ORDER BY tc.table_name, kcu.column_name;

SELECT format(
  'SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;',
  table_name,
  table_schema,
  table_name
)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%party_interaction%'
    OR table_name LIKE '%interaction%'
    OR table_name LIKE '%related%'
    OR table_name LIKE '%channel%'
    OR table_name LIKE '%attachment%'
    OR table_name LIKE '%note%'
    OR table_name LIKE '%external_identifier%'
    OR table_name LIKE '%time_period%'
    OR table_name LIKE '%quantity%'
  )
ORDER BY table_name
\gexec

SELECT format(
  'SELECT %L AS table_name, * FROM %I.%I ORDER BY 1;',
  table_name,
  table_schema,
  table_name
)
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name LIKE '%party_interaction%'
    OR table_name LIKE '%interaction%'
    OR table_name LIKE '%related%'
    OR table_name LIKE '%channel%'
    OR table_name LIKE '%attachment%'
    OR table_name LIKE '%note%'
    OR table_name LIKE '%external_identifier%'
    OR table_name LIKE '%time_period%'
    OR table_name LIKE '%quantity%'
  )
ORDER BY table_name
\gexec
