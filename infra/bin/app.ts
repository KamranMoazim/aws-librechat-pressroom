import { App, Tags } from 'aws-cdk-lib';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BackupStack } from '../lib/backup-stack.js';
import { BaseStack } from '../lib/base-stack.js';
import { BACKUP_REGION, HOME_REGION, PROJECT } from '../lib/config.js';
import { SessionStack } from '../lib/session-stack.js';

try {
  process.loadEnvFile('.env');
} catch {
  // Missing .env is reported below.
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in infra/.env (see infra/.env.example)`);
  }
  return value;
}

const account = process.env.CDK_DEFAULT_ACCOUNT;
const app = new App();
Tags.of(app).add('project', PROJECT);

new BackupStack(app, 'PressRoomBackup', { env: { account, region: BACKUP_REGION } });
const base = new BaseStack(app, 'PressRoomBase', {
  env: { account, region: HOME_REGION },
  domain: required('DOMAIN'),
  publicZoneId: required('PUBLIC_ZONE_ID'),
  alertEmail: required('ALERT_EMAIL'),
});

const samlMetadataPath = fileURLToPath(new URL('../vpn/entra-saml-metadata.xml', import.meta.url));
const serverCertificateArn = process.env.VPN_SERVER_CERT_ARN;
const vpnGroupId = process.env.VPN_ENTRA_GROUP_ID;
if (serverCertificateArn && vpnGroupId && existsSync(samlMetadataPath)) {
  new SessionStack(app, 'PressRoomSession', {
    env: { account, region: HOME_REGION },
    vpc: base.network.vpc,
    samlMetadataXml: readFileSync(samlMetadataPath, 'utf8'),
    serverCertificateArn,
    vpnGroupId,
  });
} else {
  console.error(
    'PressRoomSession skipped: set VPN_SERVER_CERT_ARN, VPN_ENTRA_GROUP_ID and add infra/vpn/entra-saml-metadata.xml',
  );
}
