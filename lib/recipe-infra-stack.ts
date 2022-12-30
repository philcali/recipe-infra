import * as cdk from 'aws-cdk-lib';
import { ArnFormat } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { RecipeApi } from './api/RecipeApi';
import { SubmoduleCode } from './SubmoduleCode';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { Constants } from './constants';
import { RecipeAuthorization } from './auth/RecipeAuthorization';
import { RecipeConsole } from './console/RecipeConsole';
import * as path from 'path';
import { Source } from 'aws-cdk-lib/aws-s3-deployment';

export class RecipeInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certificate = Certificate.fromCertificateArn(this, 'WildcardCert', this.formatArn({
      service: 'acm',
      resource: 'certificate',
      resourceName: Constants.CERTIFICATE_ID,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME
    }));

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Domain', {
      hostedZoneId: Constants.HOSTED_ZONE_ID,
      zoneName: Constants.BASE_DOMAIN
    });

    const apiDomain = `api.${Constants.BASE_DOMAIN}`;
    const consoleDomain = `app.${Constants.BASE_DOMAIN}`;
    const auth = new RecipeAuthorization(this, 'Auth', {
      enableDevelopmentOrigin: true,
      customOrigins: [
        `https://${consoleDomain}`
      ]
    });

    auth.addDomain('CustomDomain', {
      certificate,
      zone,
      domainName: `auth.${Constants.BASE_DOMAIN}`,
      createARecord: true
    });

    const api = new RecipeApi(this, 'Api', {
      apiName: 'RecipeApi',
      enableDevelopmentOrigin: true,
      customOrigins: [
        `https://${consoleDomain}`
      ],
      code: new SubmoduleCode(path.join(__dirname, 'assets', 'api'), {
        moduleName: 'lib/assets/api',
        buildCommand: './dev.make-zip.sh',
        buildOutput: 'build_function.zip'
      }),
      authorization: {
        issue: auth.userPool.userPoolProviderUrl,
        audience: [
          auth.userPoolClient.userPoolClientId
        ],
      }
    });

    api.addDomain('CustomDomain', {
      certificate,
      zone,
      domainName: apiDomain 
    });

    new RecipeConsole(this, 'Console', {
      sources: [
        Source.asset(path.join(__dirname, 'assets', 'console', 'build'))
      ],
      bucketName: 'philcali-recipe-console',
      certificate,
      zone,
      domainNames: [
        consoleDomain
      ]
    })
  }
}
