import { identityRecordsAfterCollectionReplacement } from './form-crud-persistence.mjs';
import { isConfirmedResourceStateRecord } from './operation-payload.mjs';

export function identityRecordsForResolution(
  operation,
  records = [],
  { selectionRecord, createdByApiOperations = false, allowUnconfirmed = false } = {},
) {
  const eligibleRecords = records
    .filter(record => !selectionRecord || record.source === selectionRecord.source)
    .filter(record => !createdByApiOperations || record.createdByApiOperations)
    .filter(record => allowUnconfirmed || isConfirmedResourceStateRecord(record));
  return identityRecordsAfterCollectionReplacement(operation, eligibleRecords);
}
