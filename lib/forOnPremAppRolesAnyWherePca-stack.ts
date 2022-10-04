// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Stack, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from 'constructs';
import {
  CertificateAuthority,
  CfnCertificate as CfnActivationCertificate,
  CfnCertificateAuthority,
  CfnCertificateAuthorityActivation, CfnPermission,
  ICertificateAuthority,
} from 'aws-cdk-lib/aws-acmpca';
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Bucket, BucketEncryption, BucketAccessControl, BlockPublicAccess } from "aws-cdk-lib/aws-s3";

export enum PrivateCertificateAuthorityStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED'
}

export interface PrivateCertificateAuthorityProps {
  readonly rootDomain: string
  /**
   * PCA status.
   *
   * @default ACTIVE
   */
  readonly status?: PrivateCertificateAuthorityStatus
}

export class PcaStackForRolesAnywhere extends Construct {

  public readonly certificateAuthority: ICertificateAuthority;

  constructor(scope: Construct, id: string, props: PrivateCertificateAuthorityProps) {
    super(scope, id);

    const loggingBucket = new Bucket(this, 'LoggingBucket', {
      accessControl: BucketAccessControl.LOG_DELIVERY_WRITE,
      lifecycleRules: [
        {
          enabled: true,
          expiration: Duration.days(365 * 10),
          noncurrentVersionExpiration: Duration.days(365 * 10),
        },
      ],
      versioned: true,
      encryption: BucketEncryption.S3_MANAGED,
      //removalPolicy: RemovalPolicy.RETAIN,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
    });

    const crlBucket = new Bucket(this, 'CrlBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      serverAccessLogsBucket: loggingBucket,
      versioned: true,
      enforceSSL: true,
    });
    
    const addToResourcePolicyResult = crlBucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      principals: [
        new ServicePrincipal('acm-pca.amazonaws.com')
      ],
      actions: [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetBucketAcl",
        "s3:GetBucketLocation"
      ],
      resources: [
        crlBucket.bucketArn,
        `${crlBucket.bucketArn}/*`
      ]
    }));

    // Create a Private Certificate Authority
    const cfnCertificateAuthority = new CfnCertificateAuthority(this, 'PrivateCertificateAuthority', {
      type: 'ROOT',
      keyAlgorithm: 'RSA_2048',
      signingAlgorithm: 'SHA256WITHRSA',
      subject: {
        organization: 'AwesomeExampleAtWork',
        organizationalUnit: 'AwesomeTeamAtWork',
        country: 'AU',
        state: 'NSW',
        locality: 'Sydney',
        commonName: props.rootDomain
      },
      revocationConfiguration: {
        crlConfiguration: {
          customCname: props.rootDomain,
          s3BucketName: crlBucket.bucketName,
          enabled: true,
          expirationInDays: 30,
          s3ObjectAcl: 'BUCKET_OWNER_FULL_CONTROL'
        }
      }
    });

    if (addToResourcePolicyResult.policyDependable) {
      cfnCertificateAuthority.node.addDependency(addToResourcePolicyResult.policyDependable);
    }

    // Activate the private CA with a self-signed certificate
    const activationCertificate = new CfnActivationCertificate(this, 'SelfSignedActivationCertificate', {
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      certificateSigningRequest: cfnCertificateAuthority.attrCertificateSigningRequest,
      signingAlgorithm: 'SHA256WITHRSA',
      templateArn: `arn:${Stack.of(this).partition}:acm-pca:::template/RootCACertificate/V1`,
      validity: {
        type: 'YEARS',
        value: 3
      }
    });

    new CfnCertificateAuthorityActivation(this, 'CertificateAuthorityActivation', {
      certificate: activationCertificate.attrCertificate,
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      status: props.status
    });

    // Grant private CA permission to auto-renew certificates
    new CfnPermission(this, 'AcmPcaPermission', {
      actions: ['IssueCertificate', 'GetCertificate', 'ListPermissions'],
      certificateAuthorityArn: cfnCertificateAuthority.attrArn,
      principal: 'acm.amazonaws.com',
    });

    // Only available L2 construct from CDK
    this.certificateAuthority = CertificateAuthority.fromCertificateAuthorityArn(this, 'CertificateAuthority', 
                                cfnCertificateAuthority.attrArn);
  }
}