import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const BOOTSTRAP=`set -eu
umask 077
case "$(uname -s):$(uname -m)" in
 Linux:x86_64) platform=cli-linux-x64 ;;
 Linux:aarch64|Linux:arm64) platform=cli-linux-arm64 ;;
 Darwin:x86_64) platform=cli-darwin-x64 ;;
 Darwin:arm64) platform=cli-darwin-arm64 ;;
 *) echo 'Unsupported remote platform' >&2; exit 1 ;;
esac
root="$HOME/.dsh-ssh-workspace/cli"
mkdir -p "$root"
if [ ! -x "$root/code" ]; then
 archive="$root/download-$$.tar.gz"
 trap 'rm -f "$archive"' EXIT
 curl --fail --location --silent --show-error "https://update.code.visualstudio.com/1.140.0/$platform/stable" -o "$archive"
 tar -xzf "$archive" -C "$root"
fi
"$root/code" --version >/dev/null
printf '%s\\n' "$root/code"
`;
export async function initializeHost(server,configFile,signal){
 const args=[...(server.sshArgs||[]),...(configFile?['-F',configFile]:[]),'-T','--',server.sshTarget,BOOTSTRAP];
 const {stdout}=await execute(server.sshExecutable||'ssh',args,{windowsHide:true,timeout:300000,maxBuffer:1024*1024,signal});
 const executable=stdout.trim().split(/\r?\n/).at(-1);if(!executable?.startsWith('/')||/[\r\n\0]/.test(executable))throw new Error('Remote initialization did not return a valid executable');return executable;
}
