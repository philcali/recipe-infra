import { Duration } from "aws-cdk-lib";
import { ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { 
    AccountRecovery,
    OAuthScope,
    Mfa,
    UserPoolClientIdentityProvider,
    UserPool,
    UserPoolEmail,
    UserPoolIdentityProviderGoogle,
    ClientAttributes,
    UserPoolClient
} from "aws-cdk-lib/aws-cognito";
import { ARecord, CnameRecord, IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Construct } from "constructs";
import { Constants } from "../constants";

export interface RecipeAuthorizationDomainProps {
    readonly certificate: ICertificate;
    readonly zone: IHostedZone;
    readonly domainName: string;
    readonly createARecord?: boolean;    
}

export interface RecipeAuthorizationProps {
    readonly poolName?: string;
    readonly enableDevelopmentOrigin?: boolean;
    readonly customOrigins?: string[];
}

export interface IRecipeAuthorization {
    readonly userPool: UserPool;
    readonly userPoolClient: UserPoolClient;

    addDomain(id: string, props: RecipeAuthorizationDomainProps): void;
}

export class RecipeAuthorization extends Construct implements IRecipeAuthorization {
    readonly userPool: UserPool;
    readonly userPoolClient: UserPoolClient;

    constructor(scope: Construct, id: string, props?: RecipeAuthorizationProps) {
        super(scope, id);


        const userPoolName = props?.poolName || 'recipe-user-pool';
        const userPool = new UserPool(this, 'UserPool', {
            userPoolName,
            email: UserPoolEmail.withCognito('noreply@verificationemail.com'),
            mfa: Mfa.OPTIONAL,
            accountRecovery: AccountRecovery.EMAIL_ONLY,
            enableSmsRole: false,
            mfaSecondFactor: {
                otp: true,
                sms: false
            },
            signInCaseSensitive: false,
            signInAliases: {
                username: true,
                email: true,
            },
            autoVerify: {
                email: true
            },
            keepOriginal: {
                email: true
            },
        });

        userPool.registerIdentityProvider(new UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
            userPool,
            // TODO: replace with secrets manager
            clientId: Constants.GOOGLE_CLIENT_ID,
            clientSecret: Constants.GOOGLE_SECRET_ID,
            scopes: [
                'openid',
                'profile',
                'email'
            ]
        }));

        const writeAttributes = new ClientAttributes()
            .withStandardAttributes({
                familyName: true,
                givenName: true,
                fullname: true,
                email: true
            });
        const readAttributes = writeAttributes
            .withStandardAttributes({ emailVerified: true });

        const redirectUrls = [];
        if (props?.enableDevelopmentOrigin === true) {
            redirectUrls.push('http://localhost:3000');
        }
        props?.customOrigins?.forEach(origin => redirectUrls.push(origin));
        const defaultClient = userPool.addClient('DefaultClient', {
            generateSecret: true,
            authFlows: {
                userPassword: true,
                userSrp: true
            },
            enableTokenRevocation: true,
            accessTokenValidity: Duration.days(1),
            refreshTokenValidity: Duration.days(365),
            idTokenValidity: Duration.days(1),
            userPoolClientName: `${userPoolName}-client`,
            supportedIdentityProviders: [
                UserPoolClientIdentityProvider.GOOGLE
            ],
            writeAttributes,
            readAttributes,
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                    implicitCodeGrant: true
                },
                scopes: [
                    OAuthScope.OPENID,
                    OAuthScope.EMAIL,
                    OAuthScope.PROFILE
                ],
                callbackUrls: redirectUrls.map(origin => `${origin}/login`),
                logoutUrls: redirectUrls.map(origin => `${origin}/logout`)
            }
        });

        this.userPool = userPool;
        this.userPoolClient = defaultClient;
    }

    addDomain(id: string, props: RecipeAuthorizationDomainProps): void {
        let arecord
        if (props.createARecord === true) {
            arecord = new ARecord(this, `${id}ARecord`, {
                zone: props.zone,
                target: RecordTarget.fromIpAddresses("198.51.100.1")
            });
        }

        const customAuthDomain = this.userPool.addDomain(`${id}Pool`, {
            customDomain: {
                certificate: props.certificate,
                domainName: props.domainName
            }
        });

        if (arecord) {
            customAuthDomain.node.addDependency(arecord);
        }

        new CnameRecord(this, `${id}CNAMERecord`, {
            domainName: customAuthDomain.cloudFrontDomainName,
            zone: props.zone,
            recordName: props.domainName,
            ttl: Duration.minutes(5)
        });
    }
}