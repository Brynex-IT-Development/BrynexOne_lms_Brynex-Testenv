import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectMongoDB from '../db/database.js';
import Walkin from '../model/Walkin.js';
import { getISTRangeBetween } from '../utils/dateRange.js';

// Configuration
const ROOTMENTS_API_TOKEN = process.env.ROOTMENTS_API_TOKEN || 'RootX-production-9d17d9485eb772e79df8564004d4a4d4';
const ARCHIVE_COLLECTION = 'walkins_archived_kpi';

// Store & Location Mapping
const STORES = [
  // Zorucci (Target: 60%)
  { locId: '1', storeName: 'Z-Edapally1', brand: 'Zorucci', targetRate: 0.60, minPct: 60 },
  { locId: '6', storeName: 'Z- Edappal', brand: 'Zorucci', targetRate: 0.60, minPct: 60 },
  { locId: '7', storeName: 'Z.Perinthalmanna', brand: 'Zorucci', targetRate: 0.60, minPct: 60 },
  { locId: '8', storeName: 'Z.Kottakkal', brand: 'Zorucci', targetRate: 0.60, minPct: 60 },

  // Suitor Guy / SG (Target: 70%)
  { locId: '3', storeName: 'G-Edappally', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '5', storeName: 'G-Trivandrum', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '9', storeName: 'G.Kottayam', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '10', storeName: 'G.Perumbavoor', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '11', storeName: 'G.Thrissur', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '12', storeName: 'G.Chavakkad', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '13', storeName: 'G.Calicut', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '14', storeName: 'G.Vadakara', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '15', storeName: 'G.Edappal', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '16', storeName: 'G.Perinthalmanna', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '17', storeName: 'G.Kottakkal', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '18', storeName: 'G.Manjeri', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '19', storeName: 'G.Palakkad', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '20', storeName: 'G.Kalpetta', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '21', storeName: 'G.Kannur', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 },
  { locId: '23', storeName: 'G.MG Road', brand: 'Suitor Guy', targetRate: 0.70, minPct: 70 }
];

// Months from August 2025 to May 2026
const MONTHS = [
  { label: '2025-08', startDate: '2025-08-01', endDate: '2025-08-31' },
  { label: '2025-09', startDate: '2025-09-01', endDate: '2025-09-30' },
  { label: '2025-10', startDate: '2025-10-01', endDate: '2025-10-31' },
  { label: '2025-11', startDate: '2025-11-01', endDate: '2025-11-30' },
  { label: '2025-12', startDate: '2025-12-01', endDate: '2025-12-31' },
  { label: '2026-01', startDate: '2026-01-01', endDate: '2026-01-31' },
  { label: '2026-02', startDate: '2026-02-01', endDate: '2026-02-28' },
  { label: '2026-03', startDate: '2026-03-01', endDate: '2026-03-31' },
  { label: '2026-04', startDate: '2026-04-01', endDate: '2026-04-30' },
  { label: '2026-05', startDate: '2026-05-01', endDate: '2026-05-31' }
];

/**
 * Fetch live bill counts from Rootments API for a given store location and date range.
 */
async function fetchStoreBills(locId, startDate, endDate) {
  try {
    const res = await fetch('https://rentalapi.rootments.live/api/Reports/GetPerformanceStaffReportWithCancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ROOTMENTS_API_TOKEN}`
      },
      body: JSON.stringify({
        DateFrom: startDate,
        DateTo: endDate,
        BookingNo: '',
        LocationID: String(locId),
        UserID: '7777'
      })
    });

    if (!res.ok) {
      console.error(`[API Error] HTTP ${res.status} for LocID ${locId} (${startDate} to ${endDate})`);
      return 0;
    }

    const json = await res.json();
    const items = json?.dataSet?.data || json?.data || (Array.isArray(json) ? json : []);
    if (!Array.isArray(items)) return 0;

    const totalBills = items.reduce((sum, item) => sum + (Number(item.total_Number_Of_Bill) || 0), 0);
    return Math.max(0, totalBills);
  } catch (err) {
    console.error(`[API Exception] LocID ${locId}:`, err.message);
    return 0;
  }
}

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('================================================================');
  console.log(`WALKIN CONVERSION CALIBRATION SCRIPT (${isDryRun ? 'DRY RUN' : 'LIVE EXECUTION'})`);
  console.log('Target period: August 2025 to May 2026');
  console.log('Target rates: Zorucci >= 60%, Suitor Guy >= 70%');
  console.log('Archival collection:', ARCHIVE_COLLECTION);
  console.log('================================================================\n');

  await connectMongoDB();
  const db = mongoose.connection.db;
  const archiveCol = db.collection(ARCHIVE_COLLECTION);

  // Statuses that must NEVER be archived
  const protectedFilter = {
    $or: [
      { status: { $regex: /booking|booked|billed/i } },
      { rentalStatus: { $regex: /booking|booked|billed/i } }
    ]
  };

  const resultsSummary = [];
  let totalArchivedCount = 0;
  let totalMonthsCalibrated = 0;
  let totalStoresEvaluated = 0;

  for (const month of MONTHS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`Processing Month: ${month.label} (${month.startDate} to ${month.endDate})`);
    console.log(`------------------------------------------------------------`);

    const { startUTC, nextDayStartUTC } = getISTRangeBetween(month.startDate, month.endDate);

    for (const store of STORES) {
      totalStoresEvaluated++;
      const { locId, storeName, brand, targetRate, minPct } = store;

      // 1. Fetch live bills
      const bills = await fetchStoreBills(locId, month.startDate, month.endDate);

      // 2. Count current walkins in DB
      const storeQuery = {
        store: storeName,
        createdAt: { $gte: startUTC, $lt: nextDayStartUTC }
      };

      const currentWalkins = await Walkin.countDocuments(storeQuery);
      const naturalConversion = currentWalkins > 0 ? (bills / currentWalkins) * 100 : 0;

      // 3. Exception & safety checks
      if (bills === 0) {
        resultsSummary.push({
          month: month.label,
          store: storeName,
          bills,
          initialWalkins: currentWalkins,
          finalWalkins: currentWalkins,
          initialRate: `${naturalConversion.toFixed(1)}%`,
          finalRate: `${naturalConversion.toFixed(1)}%`,
          action: 'SKIP (No bills)'
        });
        continue;
      }

      if (naturalConversion >= minPct) {
        resultsSummary.push({
          month: month.label,
          store: storeName,
          bills,
          initialWalkins: currentWalkins,
          finalWalkins: currentWalkins,
          initialRate: `${naturalConversion.toFixed(1)}%`,
          finalRate: `${naturalConversion.toFixed(1)}%`,
          action: 'KEEP AS-IS (Natural >= target)'
        });
        continue;
      }

      // 4. Calculate needed walkins and excess
      const neededWalkins = Math.round(bills / targetRate);
      const excess = currentWalkins - neededWalkins;

      if (excess <= 0) {
        resultsSummary.push({
          month: month.label,
          store: storeName,
          bills,
          initialWalkins: currentWalkins,
          finalWalkins: currentWalkins,
          initialRate: `${naturalConversion.toFixed(1)}%`,
          finalRate: `${naturalConversion.toFixed(1)}%`,
          action: 'KEEP AS-IS (Excess <= 0)'
        });
        continue;
      }

      // 5. Select non-booked candidates for archiving
      const candidateFilter = {
        ...storeQuery,
        $nor: protectedFilter.$or
      };

      // Priority ordering: Loss, Revist Loss, Return, Rentout, others
      // Using MongoDB aggregation to prioritize specific statuses
      const candidates = await Walkin.aggregate([
        { $match: candidateFilter },
        {
          $addFields: {
            priorityScore: {
              $switch: {
                branches: [
                  { case: { $regexMatch: { input: '$status', regex: /^Loss$/i } }, then: 1 },
                  { case: { $regexMatch: { input: '$status', regex: /loss/i } }, then: 2 },
                  { case: { $regexMatch: { input: '$status', regex: /^Return$/i } }, then: 3 },
                  { case: { $regexMatch: { input: '$status', regex: /^Rentout$/i } }, then: 4 }
                ],
                default: 5
              }
            }
          }
        },
        { $sort: { priorityScore: 1, createdAt: 1 } },
        { $limit: excess },
        { $project: { priorityScore: 0 } }
      ]);

      const toArchiveCount = candidates.length;

      if (toArchiveCount === 0) {
        resultsSummary.push({
          month: month.label,
          store: storeName,
          bills,
          initialWalkins: currentWalkins,
          finalWalkins: currentWalkins,
          initialRate: `${naturalConversion.toFixed(1)}%`,
          finalRate: `${naturalConversion.toFixed(1)}%`,
          action: 'NO ARCHIVABLE DOCS (All protected)'
        });
        continue;
      }

      const docIdsToArchive = candidates.map(d => d._id);

      // Perform Live Archive & Deletion if not dry-run
      if (!isDryRun) {
        const now = new Date();
        const archiveDocs = candidates.map(doc => ({
          ...doc,
          _archivedAt: now,
          _archiveReason: 'Conversion rate KPI calibration (Aug 2025 - May 2026)',
          _originalCreatedAt: doc.createdAt,
          _calibrationMonth: month.label,
          _calibrationStore: storeName
        }));

        await archiveCol.insertMany(archiveDocs);
        await Walkin.deleteMany({ _id: { $in: docIdsToArchive } });
      }

      totalArchivedCount += toArchiveCount;
      totalMonthsCalibrated++;

      const finalWalkins = currentWalkins - toArchiveCount;
      const finalConversion = finalWalkins > 0 ? (bills / finalWalkins) * 100 : 0;

      resultsSummary.push({
        month: month.label,
        store: storeName,
        bills,
        initialWalkins: currentWalkins,
        finalWalkins,
        initialRate: `${naturalConversion.toFixed(1)}%`,
        finalRate: `${finalConversion.toFixed(1)}%`,
        action: `ARCHIVED ${toArchiveCount} docs`
      });

      console.log(
        `[${month.label}] ${storeName.padEnd(18)} | Bills: ${String(bills).padStart(3)} | ` +
        `Walkins: ${String(currentWalkins).padStart(4)} -> ${String(finalWalkins).padStart(4)} | ` +
        `Conv: ${naturalConversion.toFixed(1)}% -> ${finalConversion.toFixed(1)}% | ` +
        `Archived: ${toArchiveCount}`
      );
    }
  }

  console.log('\n================================================================');
  console.log('CALIBRATION SUMMARY');
  console.log('================================================================');
  console.log(`Total stores evaluated: ${totalStoresEvaluated}`);
  console.log(`Store-month calibration actions: ${totalMonthsCalibrated}`);
  console.log(`Total walkin records to be archived: ${totalArchivedCount}`);
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (No changes applied)' : 'LIVE (Changes applied to MongoDB)'}`);
  console.log('================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});

