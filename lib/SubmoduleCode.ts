import { AssetOptions } from "aws-cdk-lib";
import { AssetCode } from "aws-cdk-lib/aws-lambda";
import * as child from 'child_process';
import * as p from 'path';

export interface SubmoduleCodeOptions extends AssetOptions {
    readonly moduleName: string;
    readonly buildCommand: string;
    readonly buildOutput: string;
}

export class SubmoduleCode extends AssetCode {
    constructor(path: string, options: SubmoduleCodeOptions) {
        child.execSync(options.buildCommand, {
            cwd: path,
        });
        super(p.join(path, options.buildOutput), {
            assetHash: child.execSync(`git submodule status | grep ${options.moduleName} | sed -E 's|([0-9A-Za-z]+) .*|\\1|'`).toString('utf-8').trim(),
            ...options
        });
    }
}