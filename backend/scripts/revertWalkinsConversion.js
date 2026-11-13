import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectMongoDB from '../db/database.js';
import Walkin from '../model/Walkin.js';

const ARCHIVE_COLLECTION = 'walkins_archived_kpi';

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('================================================================');
  console.log(`WALKIN CONVERSION REVERT SCRIPT (${isDryRun ? 'DRY RUN' : 'LIVE EXECUTION'})`);
  console.log(`Reverting records from '${ARCHIVE_COLLECTION}' back to 'walkins'`);
  console.log('================================================================\n');

  await connectMongoDB();
  const db = mongoose.connection.db;
  const archiveCol = db.collection(ARCHIVE_COLLECTION);

  // Check if archive collection exists
  const collections = await db.listCollections({ name: ARCHIVE_COLLECTION }).toArray();
  if (collections.length === 0) {
    console.log(`Archive collection '${ARCHIVE_COLLECTION}' does not exist. Nothing to revert.`);
    process.exit(0);
  }

  const totalArchived = await archiveCol.countDocuments();
  console.log(`Found ${totalArchived} archived records in '${ARCHIVE_COLLECTION}'.`);

  if (totalArchived === 0) {
    console.log('No archived records found to revert.');
    process.exit(0);
  }

  // Fetch all archived docs
  const archivedDocs = await archiveCol.find({}).toArray();

  console.log(`Preparing to restore ${archivedDocs.length} records back into 'walkins'...`);

  // Clean metadata added during calibration
  const docsToRestore = archivedDocs.map(doc => {
    const copy = { ...doc };
    delete copy._archivedAt;
    delete copy._archiveReason;
    delete copy._originalCreatedAt;
    delete copy._calibrationMonth;
    delete copy._calibrationStore;
    return copy;
  });

  if (isDryRun) {
    console.log(`[DRY RUN] Would restore ${docsToRestore.length} documents and empty '${ARCHIVE_COLLECTION}'.`);
    process.exit(0);
  }

  // Live execution:
  // 1. Re-insert docs into Walkin collection
  // Note: using insertMany in chunks of 1000 to avoid any BSON limits
  const chunkSize = 1000;
  for (let i = 0; i < docsToRestore.length; i += chunkSize) {
    const chunk = docsToRestore.slice(i, i + chunkSize);
    // Use unordered insert or check for ID collision
    await Walkin.collection.insertMany(chunk, { ordered: false });
    console.log(`Restored batch ${i + 1} to ${Math.min(i + chunkSize, docsToRestore.length)}...`);
  }

  // 2. Empty archive collection
  await archiveCol.deleteMany({});
  console.log(`Successfully restored all documents and cleared '${ARCHIVE_COLLECTION}'.`);

  console.log('\n================================================================');
  console.log('REVERT COMPLETED SUCCESSFULLY');
  console.log('================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal revert error:', err);
  process.exit(1);
});

