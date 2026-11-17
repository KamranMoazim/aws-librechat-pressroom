const month = process.env.REPORT_MONTH;
if (!/^\d{4}-\d{2}$/.test(month || '')) {
  throw new Error('REPORT_MONTH must be YYYY-MM');
}
const [year, monthNumber] = month.split('-').map(Number);
const start = new Date(Date.UTC(year, monthNumber - 1, 1));
const end = new Date(Date.UTC(year, monthNumber, 1));

const rows = db
  .getSiblingDB('LibreChat')
  .transactions.aggregate([
    {
      $match: {
        createdAt: { $gte: start, $lt: end },
        tokenType: { $in: ['prompt', 'completion'] },
      },
    },
    {
      $group: {
        _id: { user: '$user', model: '$model' },
        promptTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'prompt'] }, { $abs: '$rawAmount' }, 0] },
        },
        completionTokens: {
          $sum: { $cond: [{ $eq: ['$tokenType', 'completion'] }, { $abs: '$rawAmount' }, 0] },
        },
        credits: { $sum: { $multiply: ['$tokenValue', -1] } },
      },
    },
    { $lookup: { from: 'users', localField: '_id.user', foreignField: '_id', as: 'user' } },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    { $sort: { 'user.email': 1, '_id.model': 1 } },
  ])
  .toArray();

const csvField = (value) => {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

print('month,email,name,model,prompt_tokens,completion_tokens,usd');
for (const row of rows) {
  print(
    [
      month,
      row.user ? row.user.email : `deleted:${row._id.user}`,
      row.user ? row.user.name : '',
      row._id.model || 'unknown',
      row.promptTokens,
      row.completionTokens,
      (row.credits / 1000000).toFixed(6),
    ]
      .map(csvField)
      .join(','),
  );
}
