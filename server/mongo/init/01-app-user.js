db.getSiblingDB('LibreChat').createUser({
  user: 'librechat',
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [
    { role: 'readWrite', db: 'LibreChat' },
    { role: 'dbAdmin', db: 'LibreChat' },
  ],
});
