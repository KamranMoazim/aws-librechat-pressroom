export const PROJECT = 'pressroom';
export const VPC_CIDR = '10.40.0.0/16';
export const VPC_RESOLVER_IP = '10.40.0.2';
export const VPN_CLIENT_CIDR = '10.41.0.0/22';
export const SSM_PREFIX = '/pressroom/';
export const HOME_REGION = 'us-east-1';
export const BACKUP_REGION = 'us-west-2';
export const HOST_NAMES = ['chat', 'portal', 'bundler', 'admin'];
export const SNAPSHOT_TAG = { key: 'pressroom-backup', value: 'daily' };

export function backupBucketName(account: string): string {
  return `${PROJECT}-backup-${account}-${BACKUP_REGION}`;
}

export function internalZoneName(domain: string): string {
  return `${PROJECT}.${domain}`;
}
