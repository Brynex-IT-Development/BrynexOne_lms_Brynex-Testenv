import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import connectMongoDB from '../db/database.js';
import Walkin from '../model/Walkin.js';
import { getISTRangeBetween } from '../utils/dateRange.js';

const ROOTMENTS_API_TOKEN = process.env.ROOTMENTS_API_TOKEN || 'RootX-production-9d17d9485eb772e79df8564004d4a4d4';
const ARCHIVE_COLLECTION = 'walkins_archived_kpi';

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
    if (!res.ok) return 0;
    const json = await res.json();
    const items = json?.dataSet?.data || json?.data || (Array.isArray(json) ? json : []);
    if (!Array.isArray(items)) return 0;
    const totalBills = items.reduce((sum, item) => sum + (Number(item.total_Number_Of_Bill) || 0), 0);
    return Math.max(0, totalBills);
  } catch (err) {
    return 0;
  }
}

async function verify() {
  await connectMongoDB();
  const db = mongoose.connection.db;
  const archiveCount = await db.collection(ARCHIVE_COLLECTION).countDocuments();

  console.log('================================================================');
  console.log(`POST-CALIBRATION VERIFICATION REPORT`);
  console.log(`Archived Records Count in '${ARCHIVE_COLLECTION}': ${archiveCount}`);
  console.log('================================================================\n');

  for (const month of MONTHS) {
    console.log(`\nMonth: ${month.label} (${month.startDate} to ${month.endDate})`);
    console.log('--------------------------------------------------------------------------------------------------------');
    console.log(
      'Store'.padEnd(20) +
      'Brand'.padEnd(12) +
      'Target'.padEnd(10) +
      'Bills'.padStart(8) +
      'Walkins'.padStart(10) +
      'Conversion'.padStart(14) +
      'Status'.padStart(20)
    );
    console.log('--------------------------------------------------------------------------------------------------------');

    const { startUTC, nextDayStartUTC } = getISTRangeBetween(month.startDate, month.endDate);

    for (const store of STORES) {
      const bills = await fetchStoreBills(store.locId, month.startDate, month.endDate);
      const walkins = await Walkin.countDocuments({
        store: store.storeName,
        createdAt: { $gte: startUTC, $lt: nextDayStartUTC }
      });

      const conversion = walkins > 0 ? (bills / walkins) * 100 : 0;
      let statusNote = 'PASS';
      if (bills === 0) {
        statusNote = 'ZERO BILLS (KEPT)';
      } else if (conversion >= store.minPct - 0.9) {
        statusNote = conversion > store.minPct ? 'PASS (NATURAL/KEPT)' : 'PASS (CALIBRATED)';
      } else {
        statusNote = 'BELOW TARGET (PROTECTED)';
      }

      console.log(
        store.storeName.padEnd(20) +
        store.brand.padEnd(12) +
        `${store.minPct}%`.padEnd(10) +
        String(bills).padStart(8) +
        String(walkins).padStart(10) +
        `${conversion.toFixed(1)}%`.padStart(14) +
        statusNote.padStart(20)
      );
    }
  }

  console.log('\nVerification completed.');
  process.exit(0);
}

verify().catch(e => {
  console.error(e);
  process.exit(1);
});

