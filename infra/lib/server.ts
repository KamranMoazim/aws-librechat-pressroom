import { Stack, Tags } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { BACKUP_REGION, SNAPSHOT_TAG, SSM_PREFIX, VPC_CIDR, backupBucketName } from './config.js';

export interface ServerProps {
  vpc: ec2.IVpc;
  publicZoneId: string;
}

export const UBUNTU_AMI_PARAMETER =
  '/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id';
export const ROOT_VOLUME_GB = 60;

export class Server extends Construct {
  readonly instance: ec2.Instance;
  readonly role: iam.Role;

  constructor(scope: Construct, id: string, props: ServerProps) {
    super(scope, id);
    const stack = Stack.of(this);

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
      ],
    });
    const parameterPath = SSM_PREFIX.replace(/^\//, '');
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParametersByPath', 'ssm:GetParameters', 'ssm:GetParameter'],
        resources: [
          stack.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: parameterPath.replace(/\/$/, ''),
          }),
          stack.formatArn({
            service: 'ssm',
            resource: 'parameter',
            resourceName: `${parameterPath}*`,
          }),
        ],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'kms:ViaService': `ssm.${stack.region}.amazonaws.com` },
        },
      }),
    );
    const bucketArn = `arn:${stack.partition}:s3:::${backupBucketName(stack.account)}`;
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket', 's3:GetBucketLocation'],
        resources: [bucketArn],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:PutObjectRetention', 's3:DeleteObject'],
        resources: [`${bucketArn}/*`],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['route53:ChangeResourceRecordSets', 'route53:ListResourceRecordSets'],
        resources: [`arn:${stack.partition}:route53:::hostedzone/${props.publicZoneId}`],
      }),
    );
    this.role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['route53:GetChange', 'route53:ListHostedZones'],
        resources: ['*'],
      }),
    );

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
      description: 'PressRoom server: HTTPS from inside the VPC (VPN endpoint) only',
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4(VPC_CIDR), ec2.Port.tcp(443), 'HTTPS from VPC');

    this.instance = new ec2.Instance(this, 'Instance', {
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: new ec2.InstanceType('t4g.large'),
      machineImage: ec2.MachineImage.fromSsmParameter(UBUNTU_AMI_PARAMETER),
      associatePublicIpAddress: false,
      requireImdsv2: true,
      role: this.role,
      securityGroup,
      blockDevices: [
        {
          deviceName: '/dev/sda1',
          volume: ec2.BlockDeviceVolume.ebs(ROOT_VOLUME_GB, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            encrypted: true,
            deleteOnTermination: true,
          }),
        },
      ],
    });
    Tags.of(this.instance).add('Name', 'pressroom-srv');
    Tags.of(this.instance).add(SNAPSHOT_TAG.key, SNAPSHOT_TAG.value);
    Tags.of(this.instance).add('pressroom-backup-region', BACKUP_REGION);
  }
}
