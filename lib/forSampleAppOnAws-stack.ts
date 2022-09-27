// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps,Tags } from 'aws-cdk-lib';
import { Construct, DependencyGroup } from 'constructs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import {Key} from 'aws-cdk-lib/aws-kms';
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as fs from "fs";
import { Peer, Port, SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';
import { AuroraMysqlEngineVersion, Credentials, DatabaseCluster, DatabaseClusterEngine, ServerlessCluster, ServerlessClusterAttributes } from 'aws-cdk-lib/aws-rds';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Code, LayerVersion, Runtime } from 'aws-cdk-lib/aws-lambda';
import path = require('path');
import { NagSuppressions } from 'cdk-nag';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

interface tagConfig {
  name: string,
  appid: string,
  appfunc: string,
  appenv: string,
  dataclassification: string
}

const tagconfig: tagConfig = require('../configs/tagconfig.json');

export class SampleAppOnAWSStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // SSM parameter prep

    const asmArn = ssm.StringParameter.fromStringParameterAttributes(this, 'ASM ARN', {
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                     + tagconfig.name + "-AsmSsmPara",
    }).stringValue;

    const iamPolArn = ssm.StringParameter.fromStringParameterAttributes(this, 'IAM Policy For ASM Fetch', {
      parameterName: "/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
                      + tagconfig.name + "-IAMSsmPara",
    }).stringValue;
    
    // Create a role with specific PrincipalTag to allow secret fetch // 
    
    const allowedRole = new iam.Role(this, 'allowedRoleLambdaExecutionRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.AccountPrincipal(this.account)
      ),      
    });

    Tags.of(allowedRole).add('appid', tagconfig.appid);
    Tags.of(allowedRole).add('appfunc', tagconfig.appfunc);
    Tags.of(allowedRole).add('appenv', tagconfig.appenv);

    allowedRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'IamPolArnSSM',iamPolArn));

    // Create a role with PrincipalTag to disallow secret fetch // 

    const notAllowedRole = new iam.Role(this, 'notAllowedRoleLambdaExecutionRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.AccountPrincipal(this.account)
      ),      
    });

    Tags.of(notAllowedRole).add('appid', tagconfig.appid);
    Tags.of(notAllowedRole).add('appfunc', tagconfig.appfunc);
    Tags.of(notAllowedRole).add('appenv', "nonp");

    notAllowedRole.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, 'IamPolArn',iamPolArn));

    // Deploying a sample lambda in a VPC with connection to a MySQL Db //

    const vpc = Vpc.fromLookup(this, 'samplevpc', { 
      vpcName: 'SampleVPCStack VPC',
    });

    const securityGroupAurora = new SecurityGroup(this, 'SecurityGroupAurora', { vpc });
    securityGroupAurora.addIngressRule(Peer.ipv4(vpc.vpcCidrBlock), Port.tcp(3306));

    const secret = Secret.fromSecretAttributes(this, "ImportedSecret", {
      secretCompleteArn: ssm.StringParameter.valueForStringParameter(this,"/" + tagconfig.appid + "/" + tagconfig.appfunc + "/" + tagconfig.appenv + "/" 
      + tagconfig.name + "-AsmSsmPara")
    });

    const serverlessCluster = new ServerlessCluster(this, 'ServerlessCluster', {
      engine: DatabaseClusterEngine.auroraMysql({version: AuroraMysqlEngineVersion.VER_5_7_12,}),
      credentials: Credentials.fromSecret(secret),
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_ISOLATED,
      },
      securityGroups: [securityGroupAurora],
      enableDataApi: true,
      defaultDatabaseName: this + 'serverlessClusterForSampleApp',
      removalPolicy: RemovalPolicy.SNAPSHOT,
      deletionProtection: true,
      
    });
    serverlessCluster.addRotationSingleUser({automaticallyAfter: Duration.days(30)});

    const pymysqlLambdaLayer = new LayerVersion(this, 'SampleAppCommonLayer', {
      code: Code.fromAsset(path.join('./lambda'), {
        bundling: {
          image: Runtime.PYTHON_3_9.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output/python && cp . -r /asset-output/python/'
        ],
        },
      }),
      compatibleRuntimes: [Runtime.PYTHON_3_9],
      license: 'Apache-2.0',
      description: 'SampleApp common libraries and code',
      
    });

    // Creating log retention role

    let logRetentionLambdaPolicyStatement: PolicyStatement[] = [];
    
    logRetentionLambdaPolicyStatement.push(new PolicyStatement({
      actions: ['logs:PutRetentionPolicy', 'logs:DeleteRetentionPolicy'],
      resources: ['arn:aws:logs:' + this.region + ':' + this.account + ':log-group:/aws/lambda/' + 
                'asmFetchLambda' + '_' + tagconfig.appid  + '_' + tagconfig.appfunc + '_' + tagconfig.appenv],
      effect: iam.Effect.ALLOW,
    }));

    logRetentionLambdaPolicyStatement.push(new PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: ['arn:aws:logs:' + this.region + ':' + this.account + ':*'],
      effect: iam.Effect.ALLOW,
    }));

    //Policy to allow lambda access to cloudwatch logs
    const logRetentionLambdaExecutionRolePolicy = new ManagedPolicy(this, 'LogRetentionLambdaExecutionRolePolicy', {
      statements: logRetentionLambdaPolicyStatement,
      description: 'Policy used to allow CR for log retention',
    });

    //Create an execution role for the lambda and attach to it a policy formed from user input
    const logRetentionLambdaExecutionRole = new Role(this,
      'LogRetentionLambdaExecutionRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role used by lambda to modify log retention',
      managedPolicies: [logRetentionLambdaExecutionRolePolicy]
    });
    
    // Updating lambda execution roles for execution from an VPC

    const lambdaexecpolicy = new iam.ManagedPolicy(this, 'lambda-exec-policy', {
      description: 'Lambda IAM Policy that will allows Lambda execution within VPC for ' + tagconfig.appid,
      statements: [
        new iam.PolicyStatement({
          sid: 'AccessToLogs',
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogGroup",
            "logs:CreateLogStream",
            "logs:PutLogEvents",
          ],
          resources: ['arn:aws:logs:' + this.region + ':' + this.account + ':log-group:/aws/lambda/' + 
          'asmFetchLambda' + '_' + tagconfig.appid  + '_' + tagconfig.appfunc + '_' + tagconfig.appenv + '*'],
          }),
          new iam.PolicyStatement({
            sid: 'VpcENIAccess',
            effect: iam.Effect.ALLOW,
            actions: [
              "ec2:CreateNetworkInterface",
              "ec2:DescribeNetworkInterfaces",
              "ec2:DeleteNetworkInterface",
              "ec2:AssignPrivateIpAddresses",
              "ec2:UnassignPrivateIpAddresses"
            ],
          resources: [vpc.vpcArn]
          }),
        ]
      });
    
    allowedRole.addManagedPolicy(lambdaexecpolicy);
    notAllowedRole.addManagedPolicy(lambdaexecpolicy);

    // Deploying a sample Lambda function

    const asmFetchLambda = new lambda.Function(this, 'asmFetchLambda', {
      functionName: "asmFetchLambda" + "_" + tagconfig.appid + "_" + tagconfig.appfunc + "_" + tagconfig.appenv,
      description: "Check if lambda role can fetch asm secret",
      runtime: Runtime.PYTHON_3_9,
      handler: "index.lambda_handler",
      environment: {
          "ASM_ARN": asmArn,
          "SECRETS_MANAGER_ENDPOINT": 'https://secretsmanager.'+ this.region +'.amazonaws.com'
      },
      code: new lambda.InlineCode(fs.readFileSync('./lambda/lambda_function.py', { encoding: 'utf-8' })),
      role: allowedRole,
      vpc,
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_NAT,
      },
      layers: [ pymysqlLambdaLayer ],
      timeout: Duration.seconds(10),
      logRetention: RetentionDays.TWO_WEEKS,
      logRetentionRole: logRetentionLambdaExecutionRole,
    });

    // Add application tags
    Tags.of(asmFetchLambda).add('appid', tagconfig.appid);
    Tags.of(asmFetchLambda).add('appfunc', tagconfig.appfunc);
    Tags.of(asmFetchLambda).add('appenv', tagconfig.appenv);

    // CFN Outputs 

    new CfnOutput(this, 'sample App Lambda Output', {
      description: 'Sample Lambda App For Testing',
      value: asmFetchLambda.functionArn,
    });
    new CfnOutput(this, 'Sample Allowed IAM Role ', {
      description: 'Sample Allowed IAM Role For Testing',
      value: allowedRole.roleName,
    });
    new CfnOutput(this, 'Sample Not Allowed IAM Role ', {
      description: 'Sample Not Allowed IAM Role For Testing',
      value: notAllowedRole.roleName,
    });

    // Common cdk-nag suppressions

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-RDS6',
        reason: 'Not using IAM auth as solution is to showcase how to use Secrets Manager to store credentials.'
      },
      {
        id: 'AwsSolutions-RDS14',
        reason: 'Backtrack configuration is not adding value to the overall solution so skipping.'
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'https://github.com/aws/aws-cdk/issues/20197 -- Awaiting Serverless V2 Support.'
      },
      {
        id: 'AwsSolutions-RDS16',
        reason: 'https://github.com/aws/aws-cdk/issues/20197 -- Awaiting Serverless V2 Support.'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Suppressing finding due to LogRetention lambda created by Lambda using resource as `*`.'
      }
    ]);
  }
}