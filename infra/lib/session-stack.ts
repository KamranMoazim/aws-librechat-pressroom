import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { VPC_CIDR, VPC_RESOLVER_IP, VPN_CLIENT_CIDR } from './config.js';

export interface SessionStackProps extends StackProps {
  vpc: ec2.IVpc;
  samlMetadataXml: string;
  serverCertificateArn: string;
  vpnGroupId: string;
}

export class SessionStack extends Stack {
  constructor(scope: Construct, id: string, props: SessionStackProps) {
    super(scope, id, props);

    const [publicSubnet] = props.vpc.publicSubnets;
    const elasticIp = new ec2.CfnEIP(this, 'NatIp', { domain: 'vpc' });
    const nat = new ec2.CfnNatGateway(this, 'Nat', {
      subnetId: publicSubnet.subnetId,
      allocationId: elasticIp.attrAllocationId,
    });
    props.vpc.isolatedSubnets.forEach((subnet, index) => {
      new ec2.CfnRoute(this, `DefaultRoute${index}`, {
        routeTableId: subnet.routeTable.routeTableId,
        destinationCidrBlock: '0.0.0.0/0',
        natGatewayId: nat.ref,
      });
    });

    const samlProvider = new iam.SamlProvider(this, 'EntraSaml', {
      name: 'pressroom-entra-vpn',
      metadataDocument: iam.SamlMetadataDocument.fromXml(props.samlMetadataXml),
    });
    const logGroup = new logs.LogGroup(this, 'VpnLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const endpoint = new ec2.ClientVpnEndpoint(this, 'Vpn', {
      vpc: props.vpc,
      cidr: VPN_CLIENT_CIDR,
      serverCertificateArn: props.serverCertificateArn,
      userBasedAuthentication: ec2.ClientVpnUserBasedAuthentication.federated(samlProvider),
      splitTunnel: true,
      dnsServers: [VPC_RESOLVER_IP],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      authorizeAllUsersToVpcCidr: false,
      selfServicePortal: true,
      logGroup,
      description: 'PressRoom staff VPN (Entra SAML)',
    });
    endpoint.addAuthorizationRule('VpcForVpnGroup', {
      cidr: VPC_CIDR,
      groupId: props.vpnGroupId,
      description: 'Entra VPN group to the VPC',
    });

    new CfnOutput(this, 'VpnEndpointId', { value: endpoint.endpointId });
  }
}
