import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { BackupStack } from '../lib/backup-stack.js';
import { BaseStack } from '../lib/base-stack.js';
import { SessionStack } from '../lib/session-stack.js';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, extra?: unknown): void {
  if (ok) {
    passed++;
  } else {
    failed++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + JSON.stringify(extra)}`);
}

type Resources = Record<string, { Type: string; DeletionPolicy?: string; Properties: any }>;
const json = (value: unknown) => JSON.stringify(value);
function resourcesOf(template: Template) {
  const resources = template.toJSON().Resources as Resources;
  return (type: string) => Object.values(resources).filter((resource) => resource.Type === type);
}

const ACCOUNT = '111111111111';
const PUBLIC_ZONE_ID = 'Z0TESTZONE';
const app = new App();
const backup = new BackupStack(app, 'TestBackup', {
  env: { account: ACCOUNT, region: 'us-west-2' },
});
const base = new BaseStack(app, 'TestBase', {
  env: { account: ACCOUNT, region: 'us-east-1' },
  domain: 'example.com',
  publicZoneId: PUBLIC_ZONE_ID,
  alertEmail: 'alerts@example.com',
});
const session = new SessionStack(app, 'TestSession', {
  env: { account: ACCOUNT, region: 'us-east-1' },
  vpc: base.network.vpc,
  samlMetadataXml: `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="test"><!--${'x'.repeat(1000)}--></EntityDescriptor>`,
  serverCertificateArn: 'arn:aws:acm:us-east-1:111111111111:certificate/test',
  vpnGroupId: '00000000-0000-0000-0000-000000000001',
});

const backupOf = resourcesOf(Template.fromStack(backup));
const [bucket] = backupOf('AWS::S3::Bucket');
const bucketProps = bucket?.Properties ?? {};
check('backup stack in us-west-2', backup.region === 'us-west-2');
check(
  'backup bucket object lock governance 30 days',
  bucketProps.ObjectLockEnabled === true &&
    json(bucketProps.ObjectLockConfiguration?.Rule?.DefaultRetention) ===
      json({ Days: 30, Mode: 'GOVERNANCE' }),
  bucketProps.ObjectLockConfiguration,
);
check(
  'backup bucket versioned, private, retained',
  bucketProps.VersioningConfiguration?.Status === 'Enabled' &&
    bucketProps.PublicAccessBlockConfiguration?.BlockPublicPolicy === true &&
    bucketProps.PublicAccessBlockConfiguration?.RestrictPublicBuckets === true &&
    bucket?.DeletionPolicy === 'Retain',
  bucketProps,
);
check(
  'backup bucket name is deterministic',
  bucketProps.BucketName === `pressroom-backup-${ACCOUNT}-us-west-2`,
  bucketProps.BucketName,
);

const baseOf = resourcesOf(Template.fromStack(base));
check('base has no nat gateway', baseOf('AWS::EC2::NatGateway').length === 0);
const [instance] = baseOf('AWS::EC2::Instance');
const instanceProps = instance?.Properties ?? {};
check(
  'instance is t4g.large',
  instanceProps.InstanceType === 't4g.large',
  instanceProps.InstanceType,
);
check(
  'instance has no public ip',
  !json(instanceProps).includes('"AssociatePublicIpAddress":true'),
  instanceProps.NetworkInterfaces,
);
const [launchTemplate] = baseOf('AWS::EC2::LaunchTemplate');
check(
  'imdsv2 required',
  launchTemplate?.Properties?.LaunchTemplateData?.MetadataOptions?.HttpTokens === 'required',
  launchTemplate?.Properties,
);
const rootVolume = instanceProps.BlockDeviceMappings?.[0]?.Ebs ?? {};
check(
  'root volume gp3 60 GB encrypted',
  rootVolume.VolumeType === 'gp3' && rootVolume.VolumeSize === 60 && rootVolume.Encrypted === true,
  rootVolume,
);
check(
  'instance tagged for daily snapshots',
  json(instanceProps.Tags).includes(json({ Key: 'pressroom-backup', Value: 'daily' })),
  instanceProps.Tags,
);
const serverGroups = baseOf('AWS::EC2::SecurityGroup');
const ingress = serverGroups.flatMap((group) => group.Properties.SecurityGroupIngress ?? []);
check(
  'only ingress is 443 from the vpc',
  ingress.length === 1 &&
    ingress[0].CidrIp === '10.40.0.0/16' &&
    ingress[0].FromPort === 443 &&
    ingress[0].ToPort === 443,
  ingress,
);

const policies = baseOf('AWS::IAM::Policy');
const statements = policies.flatMap((policy) => policy.Properties.PolicyDocument.Statement);
const allowing = (action: string) =>
  statements.filter((statement: any) => [statement.Action].flat().includes(action));
const ssmResources = json(allowing('ssm:GetParametersByPath').map((s: any) => s.Resource));
check(
  'ssm read limited to /pressroom',
  ssmResources.includes('parameter/pressroom/*') && !ssmResources.includes('"*"'),
  ssmResources,
);
const putResources = json(allowing('s3:PutObject').map((s: any) => s.Resource));
check(
  's3 write limited to the backup bucket',
  putResources.includes(`:s3:::pressroom-backup-${ACCOUNT}-us-west-2/*`) &&
    !putResources.includes('"*"'),
  putResources,
);
const retentionResources = json(allowing('s3:PutObjectRetention').map((s: any) => s.Resource));
check(
  'server may set object lock retention only in the backup bucket',
  retentionResources.includes(`pressroom-backup-${ACCOUNT}-us-west-2/*`) &&
    !retentionResources.includes('"*"'),
  retentionResources,
);
const changeResources = json(
  allowing('route53:ChangeResourceRecordSets').map((s: any) => s.Resource),
);
check(
  'route53 changes limited to the public zone',
  changeResources.includes(`hostedzone/${PUBLIC_ZONE_ID}`) && !changeResources.includes('"*"'),
  changeResources,
);

const [ruleGroup] = baseOf('AWS::Route53Resolver::FirewallRuleGroup');
const rules = (ruleGroup?.Properties?.FirewallRules ?? []).map((rule: any) => ({
  priority: rule.Priority,
  action: rule.Action,
  response: rule.BlockResponse,
  redirection: rule.FirewallDomainRedirectionAction,
}));
check(
  'firewall rules allow (trusting cnames), allow, block nxdomain',
  json(rules) ===
    json([
      { priority: 100, action: 'ALLOW', redirection: 'TRUST_REDIRECTION_DOMAIN' },
      { priority: 200, action: 'ALLOW', redirection: 'TRUST_REDIRECTION_DOMAIN' },
      { priority: 300, action: 'BLOCK', response: 'NXDOMAIN' },
    ]),
  rules,
);
const domainLists = Object.fromEntries(
  baseOf('AWS::Route53Resolver::FirewallDomainList').map((list) => [
    list.Properties.Name,
    list.Properties.Domains,
  ]),
);
check('block list is *', json(domainLists['pressroom-everything']) === json(['*']), domainLists);
check(
  'updates list starts empty',
  'pressroom-updates' in domainLists && domainLists['pressroom-updates'] === undefined,
  domainLists,
);
const allowed: string[] = domainLists['pressroom-allowed'] ?? [];
check(
  'allowlist has providers, not mistral',
  ['api.anthropic.com', 'api.openai.com', 'api.x.ai', 'ssm.us-east-1.amazonaws.com'].every(
    (domain) => allowed.includes(domain),
  ) && !allowed.some((domain) => domain.includes('mistral')),
  allowed,
);
check(
  'allowlist has the relevance api host and elevenlabs, not the relevance website',
  allowed.includes('*.stack.tryrelevance.com') &&
    allowed.includes('api.elevenlabs.io') &&
    !allowed.some((domain) => domain.endsWith('relevanceai.com')),
  allowed,
);
check(
  'rule group associated with vpc',
  baseOf('AWS::Route53Resolver::FirewallRuleGroupAssociation').length === 1,
);
const [firewallConfig] = baseOf('AWS::Route53Resolver::FirewallConfig');
check(
  'firewall fails closed',
  firewallConfig?.Properties?.FirewallFailOpen === 'DISABLED',
  firewallConfig?.Properties,
);

const [zone] = baseOf('AWS::Route53::HostedZone');
check(
  'private zone pressroom.example.com on the vpc',
  zone?.Properties?.Name === 'pressroom.example.com.' &&
    (zone?.Properties?.VPCs ?? []).length === 1,
  zone?.Properties,
);
const recordNames = baseOf('AWS::Route53::RecordSet')
  .filter((record) => record.Properties.Type === 'A')
  .map((record) => record.Properties.Name)
  .sort();
check(
  'four internal A records',
  json(recordNames) ===
    json(['admin', 'bundler', 'chat', 'portal'].map((host) => `${host}.pressroom.example.com.`)),
  recordNames,
);

const [lifecycle] = baseOf('AWS::DLM::LifecyclePolicy');
const schedule = lifecycle?.Properties?.PolicyDetails?.Schedules?.[0] ?? {};
check(
  'dlm daily snapshots keep 7',
  schedule.RetainRule?.Count === 7 && schedule.CreateRule?.Interval === 24,
  schedule,
);
const [budget] = baseOf('AWS::Budgets::Budget');
check(
  'budget 25 usd on project tag',
  budget?.Properties?.Budget?.BudgetLimit?.Amount === 25 &&
    json(budget?.Properties?.Budget?.CostFilters) ===
      json({ TagKeyValue: ['user:project$pressroom'] }),
  budget?.Properties?.Budget,
);

const deployBuckets = baseOf('AWS::S3::Bucket');
check(
  'deploy bucket private, objects expire in 7 days',
  deployBuckets.length === 1 &&
    deployBuckets[0].Properties.PublicAccessBlockConfiguration?.BlockPublicPolicy === true &&
    json(deployBuckets[0].Properties.LifecycleConfiguration?.Rules).includes(
      '"ExpirationInDays":7',
    ),
  deployBuckets,
);
check(
  'allowlist has s3 in both regions for deploy and backup',
  ['*.s3.us-east-1.amazonaws.com', '*.s3.us-west-2.amazonaws.com'].every((domain) =>
    allowed.includes(domain),
  ),
  allowed,
);

const [spendSchedule] = baseOf('AWS::Scheduler::Schedule');
const scheduleProps = spendSchedule?.Properties ?? {};
check(
  'monthly spend report runs the server script via ssm',
  scheduleProps.ScheduleExpression === 'cron(0 6 1 * ? *)' &&
    scheduleProps.Target?.Arn === 'arn:aws:scheduler:::aws-sdk:ssm:sendCommand' &&
    json(scheduleProps.Target?.Input).includes('/opt/pressroom/server/bin/spend-report.sh'),
  scheduleProps,
);
const sendCommand = json(allowing('ssm:SendCommand').map((s: any) => s.Resource));
check(
  'scheduler may only run AWS-RunShellScript on the server',
  sendCommand.includes('document/AWS-RunShellScript') &&
    sendCommand.includes('instance/') &&
    !sendCommand.includes('"*"'),
  sendCommand,
);

const sessionOf = resourcesOf(Template.fromStack(session));
check('session has one nat gateway', sessionOf('AWS::EC2::NatGateway').length === 1);
const routes = sessionOf('AWS::EC2::Route');
check(
  'session adds a default route',
  routes.length === 1 && routes[0].Properties.DestinationCidrBlock === '0.0.0.0/0',
  routes,
);
const [vpn] = sessionOf('AWS::EC2::ClientVpnEndpoint');
const vpnProps = vpn?.Properties ?? {};
check(
  'client vpn split tunnel, own cidr, vpc resolver',
  vpnProps.SplitTunnel === true &&
    vpnProps.ClientCidrBlock === '10.41.0.0/22' &&
    json(vpnProps.DnsServers) === json(['10.40.0.2']),
  vpnProps,
);
check(
  'client vpn federated auth',
  vpnProps.AuthenticationOptions?.[0]?.Type === 'federated-authentication',
  vpnProps.AuthenticationOptions,
);
const authRules = sessionOf('AWS::EC2::ClientVpnAuthorizationRule');
check(
  'vpn authorization only for the entra group',
  authRules.length === 1 &&
    authRules[0].Properties.AccessGroupId === '00000000-0000-0000-0000-000000000001' &&
    authRules[0].Properties.AuthorizeAllGroups !== true,
  authRules,
);
check(
  'vpn associated with one subnet',
  sessionOf('AWS::EC2::ClientVpnTargetNetworkAssociation').length === 1,
);

const alarms = Object.fromEntries(
  baseOf('AWS::CloudWatch::Alarm').map((alarm) => [alarm.Properties.AlarmName, alarm.Properties]),
);
const alarmShape = (name: string) => {
  const alarm = alarms[name] ?? {};
  return {
    metric: `${alarm.Namespace}/${alarm.MetricName}`,
    threshold: alarm.Threshold,
    operator: alarm.ComparisonOperator,
    periods: alarm.EvaluationPeriods,
  };
};
check(
  'alarms: disk 80, backup 26 h, cert 14 days, restarts, unhealthy, memory, status check',
  json([
    alarmShape('pressroom-disk'),
    alarmShape('pressroom-backup-age'),
    alarmShape('pressroom-cert-expiry'),
    alarmShape('pressroom-api-restarts'),
    alarmShape('pressroom-unhealthy'),
    alarmShape('pressroom-memory'),
    alarmShape('pressroom-status-check'),
  ]) ===
    json([
      {
        metric: 'CWAgent/disk_used_percent',
        threshold: 80,
        operator: 'GreaterThanThreshold',
        periods: 2,
      },
      {
        metric: 'PressRoom/BackupAgeHours',
        threshold: 26,
        operator: 'GreaterThanThreshold',
        periods: 1,
      },
      {
        metric: 'PressRoom/CertDaysLeft',
        threshold: 14,
        operator: 'LessThanThreshold',
        periods: 1,
      },
      {
        metric: 'PressRoom/ApiRestarts',
        threshold: 0,
        operator: 'GreaterThanThreshold',
        periods: 1,
      },
      {
        metric: 'PressRoom/UnhealthyContainers',
        threshold: 0,
        operator: 'GreaterThanThreshold',
        periods: 3,
      },
      {
        metric: 'CWAgent/mem_used_percent',
        threshold: 90,
        operator: 'GreaterThanThreshold',
        periods: 3,
      },
      {
        metric: 'AWS/EC2/StatusCheckFailed',
        threshold: 0,
        operator: 'GreaterThanThreshold',
        periods: 2,
      },
    ]),
  alarms,
);
check(
  'every alarm notifies the alerts topic on alarm and on ok',
  Object.values(alarms).length === 7 &&
    Object.values(alarms).every(
      (alarm: any) => alarm.AlarmActions?.length === 1 && alarm.OKActions?.length === 1,
    ),
);
check(
  'alarms are scoped to the server instance',
  Object.values(alarms).every((alarm: any) =>
    (alarm.Dimensions ?? []).some((dimension: any) => dimension.Name === 'InstanceId'),
  ),
);
const subscriptions = baseOf('AWS::SNS::Subscription');
check(
  'alerts go to the alert email',
  subscriptions.length === 1 &&
    subscriptions[0].Properties.Protocol === 'email' &&
    subscriptions[0].Properties.Endpoint === 'alerts@example.com',
  subscriptions,
);
check('no restore drill instance by default', baseOf('AWS::EC2::Instance').length === 1);

const drillApp = new App({ context: { restore: 'true' } });
const drillBase = new BaseStack(drillApp, 'TestDrill', {
  env: { account: ACCOUNT, region: 'us-east-1' },
  domain: 'example.com',
  publicZoneId: PUBLIC_ZONE_ID,
  alertEmail: 'alerts@example.com',
});
const drillInstances = resourcesOf(Template.fromStack(drillBase))('AWS::EC2::Instance');
const tagsOf = (resource: any) =>
  Object.fromEntries((resource.Properties.Tags ?? []).map((tag: any) => [tag.Key, tag.Value]));
const drill = drillInstances.find((resource) => tagsOf(resource).Name === 'pressroom-restore');
check(
  'restore=true adds a pressroom-restore instance without daily snapshots',
  drillInstances.length === 2 && drill !== undefined && !('pressroom-backup' in tagsOf(drill)),
  drillInstances.map(tagsOf),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
