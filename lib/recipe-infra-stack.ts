import * as cdk from 'aws-cdk-lib';
import { ArnFormat } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import { RecipeApi } from './api/RecipeApi';
import { SubmoduleCode } from './SubmoduleCode';
import * as path from 'path';
import { HostedZone } from 'aws-cdk-lib/aws-route53';

const CERTIFICATE_ID = 'cfd2c4cd-65f5-4f22-afc3-d25a21175478';
const HOSTED_ZONE_ID = 'Z2E8L1UCDS6NK5';

export class RecipeInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const certificate = Certificate.fromCertificateArn(this, 'WildcardCert', this.formatArn({
      service: 'acm',
      resource: 'certificate',
      resourceName: CERTIFICATE_ID,
      arnFormat: ArnFormat.SLASH_RESOURCE_NAME
    }));

    const zone = HostedZone.fromHostedZoneAttributes(this, 'Domain', {
      hostedZoneId: HOSTED_ZONE_ID,
      zoneName: 'petroni.us'
    })

    const api = new RecipeApi(this, 'Api', {
      apiName: 'RecipeApi',
      code: new SubmoduleCode(path.join(__dirname, 'assets', 'api'), {
        moduleName: 'lib/assets/api',
        buildCommand: './dev.make-zip.sh',
        buildOutput: 'build_function.zip'
      })
    });

    api.addDomain('CustomDomain', {
      certificate,
      zone,
      domainName: 'api.petroni.us',
    })
  }
}
