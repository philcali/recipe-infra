import { ArnFormat, Duration, Stack } from "aws-cdk-lib";
import { 
    CfnApi,
    CfnApiMapping,
    CfnAuthorizer,
    CfnDomainName,
    CfnIntegration,
    CfnRoute,
    CfnRouteProps,
    CfnStage
} from "aws-cdk-lib/aws-apigatewayv2";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { AttributeType, BillingMode, ITable, StreamViewType, Table } from "aws-cdk-lib/aws-dynamodb";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Code, Function, IFunction, Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { CnameRecord, IHostedZone } from "aws-cdk-lib/aws-route53";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";


export interface RecipeApiAuthorizationProps {
    readonly issue: string;
    readonly audience: string[];
    readonly scopes?: string[];
}

export interface RecipeApiProps {
    readonly apiName?: string;
    readonly table?: ITable;
    readonly code: Code;
    readonly enableDevelopmentOrigin?: boolean;
    readonly customOrigins?: string[];
    readonly authorization?: RecipeApiAuthorizationProps;
}

export interface RecipeApiDomainProps {
    readonly certificate: ICertificate;
    readonly zone: IHostedZone;
    readonly domainName: string;
}

export interface IRecipeApi {
    readonly table: ITable;
    readonly serviceFunction: IFunction;
    readonly apiId: string;
    readonly stageId: string;

    addDomain(id: string, props: RecipeApiDomainProps): void;
}

export class RecipeApi extends Construct implements IRecipeApi {
    readonly table: ITable;
    readonly serviceFunction: IFunction;
    readonly apiId: string;
    readonly stageId: string;
    readonly notifications: ITopic;

    constructor(scope: Construct, id: string, props: RecipeApiProps) {
        super(scope, id);

        let table = props.table;
        if (!table) {
            table = new Table(this, 'Data', {
                partitionKey: {
                    name: 'PK',
                    type: AttributeType.STRING
                },
                billingMode: BillingMode.PROVISIONED,
                readCapacity: 1,
                writeCapacity: 1,
                sortKey: {
                    name: 'SK',
                    type: AttributeType. STRING
                },
                tableName: 'RecipeData',
                timeToLiveAttribute: 'expiresIn',
                stream: StreamViewType.NEW_AND_OLD_IMAGES,
            });
        }
        this.table = table;

        this.notifications = new Topic(this, 'Notifications', {
            displayName: "Recipe Notifications",
            topicName: "RecipeNotifications",
        });

        let serviceFunction = new Function(this, 'Function', {
            handler: 'bootstrap',
            runtime: Runtime.PROVIDED_AL2,
            code: props.code,
            memorySize: 512,
            timeout: Duration.seconds(30),
            environment: {
                'TABLE_NAME': this.table.tableName,
                'TOPIC_ARN': this.notifications.topicArn,
            },
            architecture: Architecture.X86_64
        });
        this.serviceFunction = serviceFunction;

        this.serviceFunction.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
            ],
            resources: [
                this.table.tableArn
            ]
        }));

        let allowOrigins = [];
        if (props.enableDevelopmentOrigin === true) {
            allowOrigins.push('http://localhost:3000');
        }
        props.customOrigins?.forEach(origin => allowOrigins.push(origin));
        const apiName = props.apiName || 'RecipeApi';
        const api = new CfnApi(this, 'Http', {
            name: apiName,
            protocolType: 'HTTP',
            corsConfiguration: {
                allowCredentials: true,
                allowHeaders: [
                    'Content-Type',
                    'Content-Length',
                    'Accept',
                    'Authorization',
                ],
                allowMethods: [
                    'PUT',
                    'POST',
                    'GET',
                    'OPTIONS',
                    'DELETE',
                ],
                allowOrigins
            },
            routeSelectionExpression: '$request.method $request.path'
        });
        this.apiId = api.ref;

        const resourceIntegration = new CfnIntegration(this, 'FunctionIntegration', {
            apiId: this.apiId,
            integrationType: 'AWS_PROXY',
            connectionType: 'INTERNET',
            integrationMethod: 'POST',
            payloadFormatVersion: '2.0',
            timeoutInMillis: Duration.seconds(30).toMilliseconds(),
            integrationUri: this.serviceFunction.functionArn
        });

        let functionRoute: CfnRouteProps = {
            apiId: this.apiId,
            routeKey: '$default',
            target: `integrations/${resourceIntegration.ref}`
        };
        if (props.authorization) {
            new CfnRoute(this, 'UnauthorizedRoute', {
                apiId: this.apiId,
                routeKey: 'OPTIONS /{proxy+}',
                target: `integrations/${resourceIntegration.ref}`
            });

            const cognitoAuth = new CfnAuthorizer(this, 'Authorization', {
                apiId: this.apiId,
                authorizerType: 'JWT',
                identitySource: ['$request.header.Authorization'],
                jwtConfiguration: {
                    issuer: props.authorization.issue,
                    audience: props.authorization.audience
                },
                name: `${apiName}-auth`
            });

            functionRoute = {
                ...functionRoute,
                authorizationScopes: props.authorization.scopes,
                authorizationType: 'JWT',
                authorizerId: cognitoAuth.ref
            }
        }
        const resourceDefaultRoute = new CfnRoute(this, 'DefaultRoute', functionRoute);
        const resourceStage = new CfnStage(this, 'Deployment', {
            apiId: this.apiId,
            stageName: '$default',
            autoDeploy: true
        });
        resourceStage.addDependency(resourceDefaultRoute);
        this.stageId = resourceStage.ref;

        const stack = Stack.of(this);
        this.serviceFunction.addPermission('Invoke', {
            principal: new ServicePrincipal('apigateway.amazonaws.com'),
            action: 'lambda:InvokeFunction',
            sourceArn: stack.formatArn({
                service: 'execute-api',
                resource: this.apiId,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
                resourceName: "*/*"
            })
        });

        // Allow the service to handle synchronous subscription passthrough
        this.serviceFunction.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                "sns:Subscribe"
            ],
            resources: [
                this.notifications.topicArn
            ]
        }));

        this.serviceFunction.addToRolePolicy(new PolicyStatement({
            effect: Effect.ALLOW,
            actions: [
                'Unsubscribe',
                'GetSubscriptionAttributes',
                'SetSubscriptionAttributes',
            ].map(action => `sns:${action}`),
            resources: [ '*' ],
        }))
    }

    addDomain(id: string, props: RecipeApiDomainProps): void {
        const domainCreation = new CfnDomainName(this, `${id}Name`, {
            domainName: props.domainName,
            domainNameConfigurations: [
                {
                    certificateArn: props.certificate.certificateArn,
                    endpointType: 'REGIONAL',
                    securityPolicy: 'TLS_1_2'
                }
            ]
        });

        const mappingResource = new CfnApiMapping(this, `${id}Mapping`, {
            apiId: this.apiId,
            domainName: props.domainName,
            stage: this.stageId
        });
        mappingResource.addDependency(domainCreation);

        new CnameRecord(this, `${id}CNAME`, {
            domainName: domainCreation.attrRegionalDomainName,
            zone: props.zone,
            recordName: props.domainName,
            ttl: Duration.minutes(5)
        });
    }
}