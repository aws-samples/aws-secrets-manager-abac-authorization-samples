// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnOutput, StackProps } from 'aws-cdk-lib';
import { SubnetType, Vpc as EC2Vpc, InterfaceVpcEndpointAwsService, ISubnet, FlowLog, FlowLogResourceType, FlowLogDestination } from 'aws-cdk-lib/aws-ec2';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

interface tagConfig {
  name: string,
  appid: string,
  appfunc: string,
  appenv: string,
  dataclassification: string
}

const tagconfig: tagConfig = require('../configs/tagconfig.json');

export class newVpcAndEndpoints extends Construct {
  public readonly newSampleAppVPC: EC2Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id);

    this.newSampleAppVPC = new EC2Vpc(this, 'VPC', {
      subnetConfiguration: [
         {
           cidrMask: 24,
           name: 'ingress',
           subnetType: SubnetType.PUBLIC,
         },
         {
           cidrMask: 24,
           name: 'application',
           subnetType: SubnetType.PRIVATE_WITH_NAT,
         },
         {
           cidrMask: 28,
           name: 'rds',
           subnetType: SubnetType.PRIVATE_ISOLATED,
         }
      ],
      cidr: '172.31.0.0/16',
      vpcName: 'SampleVPCStack VPC',
    });

    // Enabling Flow Logs //

    const logGroup = new LogGroup(this, 'MyCustomLogGroup');

    const role = new Role(this, 'MyCustomRole', {
      assumedBy: new ServicePrincipal('vpc-flow-logs.amazonaws.com')
    });

    new FlowLog(this, 'FlowLog', {
      resourceType: FlowLogResourceType.fromVpc(this.newSampleAppVPC),
      destination: FlowLogDestination.toCloudWatchLogs(logGroup, role)
    });

    // Creating Secrets Manager and KMS service endpoints // 

    this.newSampleAppVPC.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      privateDnsEnabled: true,
    });

    this.newSampleAppVPC.addInterfaceEndpoint('KMSEndpoint', {
      service: InterfaceVpcEndpointAwsService.KMS,
      privateDnsEnabled: true,
    });

    const appVpcSsmParam = new StringParameter(this, 'Sample VPC StringParameter', {
      description: 'SSM Parameter to store IAM Policy ARN for' + tagconfig.appid,
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                    + tagconfig.name + "-appVpcSsmParam",
      simpleName: false,
      stringValue: this.newSampleAppVPC.vpcId
    });
  }
}
