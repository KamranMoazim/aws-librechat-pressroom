import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { Budget } from './budget.js';
import { Deploy } from './deploy.js';
import { Dns } from './dns.js';
import { DnsFirewall } from './dns-firewall.js';
import { Network } from './network.js';
import { Schedules } from './schedules.js';
import { Server } from './server.js';
import { Snapshots } from './snapshots.js';

export interface BaseStackProps extends StackProps {
  domain: string;
  publicZoneId: string;
  alertEmail: string;
}

export class BaseStack extends Stack {
  readonly network: Network;
  readonly server: Server;

  constructor(scope: Construct, id: string, props: BaseStackProps) {
    super(scope, id, props);

    this.network = new Network(this, 'Network');
    this.server = new Server(this, 'Server', {
      vpc: this.network.vpc,
      publicZoneId: props.publicZoneId,
    });
    const dns = new Dns(this, 'Dns', {
      domain: props.domain,
      vpc: this.network.vpc,
      serverPrivateIp: this.server.instance.instancePrivateIp,
    });
    new DnsFirewall(this, 'DnsFirewall', { domain: props.domain, vpc: this.network.vpc });
    new Snapshots(this, 'Snapshots');
    new Budget(this, 'Budget', { alertEmail: props.alertEmail });
    const deploy = new Deploy(this, 'Deploy');
    new Schedules(this, 'Schedules', { instance: this.server.instance });

    new CfnOutput(this, 'InstanceId', { value: this.server.instance.instanceId });
    new CfnOutput(this, 'PrivateIp', { value: this.server.instance.instancePrivateIp });
    new CfnOutput(this, 'InternalZone', { value: dns.zone.zoneName });
    new CfnOutput(this, 'DeployBucket', { value: deploy.bucket.bucketName });
  }
}
