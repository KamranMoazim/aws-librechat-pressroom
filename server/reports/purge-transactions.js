const keepMonths = Number(process.env.KEEP_MONTHS || '13');
const cutoff = new Date();
cutoff.setUTCMonth(cutoff.getUTCMonth() - keepMonths, 1);
cutoff.setUTCHours(0, 0, 0, 0);
const result = db
  .getSiblingDB('LibreChat')
  .transactions.deleteMany({ createdAt: { $lt: cutoff } });
print(`deleted ${result.deletedCount} transactions before ${cutoff.toISOString()}`);
