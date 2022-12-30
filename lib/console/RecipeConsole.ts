import { Duration } from "aws-cdk-lib";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { AllowedMethods, Distribution, HttpVersion, IDistribution, PriceClass, SecurityPolicyProtocol, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { CnameRecord, IHostedZone } from "aws-cdk-lib/aws-route53";
import { Bucket, HttpMethods, IBucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, ISource } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";

export interface RecipeConsoleProps {
    readonly bucket?: IBucket;
    readonly bucketName?: string;
    readonly distribution?: IDistribution;
    readonly certificate?: ICertificate;
    readonly zone?: IHostedZone;
    readonly domainNames?: string[];
    readonly sources: ISource[];
}

export interface IRecipeConsole {
    readonly bucket: IBucket;
    readonly distribution: IDistribution;
}

export class RecipeConsole extends Construct implements IRecipeConsole {
    readonly bucket: IBucket;
    readonly distribution: IDistribution;

    constructor(scope: Construct, id: string, props: RecipeConsoleProps) {
        super(scope, id);

        if (props.bucket && props.bucketName) {
            throw new Error("Cannot specify both a bucket and a bucket name for a managed bucket.");
        }

        if (props.distribution && (props.certificate || props.domainNames)) {
            throw new Error("Cannot specify both a distribution and properties for a managed distribution.");
        }

        this.bucket = props.bucket || new Bucket(this, 'Bucket', {
            bucketName: props.bucketName,
            publicReadAccess: false,
            cors: [
                {
                    allowedOrigins: [ "*" ],
                    allowedMethods: [
                        HttpMethods.GET,
                        HttpMethods.HEAD
                    ]
                }
            ]
        });

        this.distribution = props.distribution || new Distribution(this, 'Distribution', {
            defaultBehavior: {
                origin: new S3Origin(this.bucket),
                viewerProtocolPolicy: ViewerProtocolPolicy.HTTPS_ONLY,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS
            },
            certificate: props.certificate,
            domainNames: props.domainNames,
            priceClass: PriceClass.PRICE_CLASS_100,
            enabled: true,
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            httpVersion: HttpVersion.HTTP1_1,
            errorResponses: [403, 404].map(code => {
                return {
                    httpStatus: code,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: Duration.minutes(5)
                }
            })
        });

        if (props.zone && props.domainNames) {
            let zone = props.zone;
            props.domainNames.forEach((domainName, index) => {
                new CnameRecord(this, `DistributionCNAME${index + 1}`, {
                    domainName: this.distribution.distributionDomainName,
                    zone,
                    recordName: domainName,
                    ttl: Duration.minutes(5)
                });
            })
        }

        new BucketDeployment(this, 'Deployment', {
            sources: props.sources,
            destinationBucket: this.bucket,
            distribution: this.distribution
        });
    }
}