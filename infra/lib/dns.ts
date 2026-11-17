import { Duration } from 'aws-cdk-lib';
import type * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import { Construct } from 'constructs';
import { HOST_NAMES, internalZoneName } from './config.js';

export interface DnsProps {
  domain: string;
  vpc: ec2.IVpc;
  serverPrivateIp: string;
}

export class Dns extends Construct {
  readonly zone: route53.PrivateHostedZone;

  constructor(scope: Construct, id: string, props: DnsProps) {
    super(scope, id);

    this.zone = new route53.PrivateHostedZone(this, 'Zone', {
      zoneName: internalZoneName(props.domain),
      vpc: props.vpc,
    });
    for (const host of HOST_NAMES) {
      new route53.ARecord(this, `${host}Record`, {
        zone: this.zone,
        recordName: host,
        target: route53.RecordTarget.fromIpAddresses(props.serverPrivateIp),
        ttl: Duration.minutes(5),
      });
    }
  }
}
