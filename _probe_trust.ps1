<#
  Negative probes for _trust_check.cjs.

  A harness that cannot fail is a harness that proves nothing. Each probe below breaks one thing
  the checks are supposed to guard, runs the harness, and requires that *named* check to be the
  one that bites. Then the file goes back byte-exact (SHA-256), the backup is removed, and -- for
  the two probes that touch `src/trust.ts` -- the compiled module is rebuilt from the restored
  source, so `_dsbuild/trust.cjs` still matches what is committed.

  ASCII only, and no BOM: Windows PowerShell reads a .ps1 as ANSI, so an em dash here becomes a
  parse error rather than a comment.

    powershell -File _probe_trust.ps1
#>
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$harness = Join-Path $root '_trust_check.cjs'

function HashOf([string] $p) { (Get-FileHash -Algorithm SHA256 -Path $p).Hash }

function Rebuild-Trust {
  & npx tsc --ignoreConfig src/trust.ts --outDir _dsbuild --module commonjs --target es2020 --skipLibCheck | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'tsc failed while rebuilding src/trust.ts' }
  Move-Item -Force (Join-Path $root '_dsbuild\trust.js') (Join-Path $root '_dsbuild\trust.cjs')
}

function Probe([string] $name, [string] $file, [string] $before, [string] $after, [string] $expected, [bool] $rebuild) {
  $backup = "$file.probe"
  Copy-Item -Force $file $backup
  $original = HashOf $file
  try {
    $text = [IO.File]::ReadAllText($file)
    # If the anchor is stale the probe would edit nothing and "pass" for the wrong reason.
    $hits = ([regex]::Matches($text, [regex]::Escape($before))).Count
    if ($hits -ne 1) { throw "this probe's anchor matches $hits times, not once -- fix the probe" }
    [IO.File]::WriteAllText($file, $text.Replace($before, $after))
    if ($rebuild) { Rebuild-Trust }

    # Windows PowerShell turns a native command's stderr into a *terminating* error when
    # ErrorActionPreference is Stop -- and a failing harness writes its failure to stderr. So the
    # preference is relaxed for exactly the length of the call.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # -Width: Out-String wraps at the console width, which would break a check's name across two
    # lines and make the match below fail for the wrong reason.
    $output = (& node $harness 2>&1 | Out-String -Width 4096)
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previous

    if ($code -eq 0) { throw 'the harness passed with the bug in place' }
    if ($output -notmatch [regex]::Escape($expected)) {
      throw "the harness failed, but not on '$expected':`n$output"
    }
    Write-Host ("  ok  {0}" -f $name)
  } finally {
    Copy-Item -Force $backup $file
    Remove-Item -Force $backup
    if ($rebuild) { Rebuild-Trust }
    if ((HashOf $file) -ne $original) { throw "restoring $file changed it" }
  }
}

$setup = Join-Path $root 'src\SetupStore.tsx'
$recovery = Join-Path $root 'src\RecoveryModal.tsx'
$trust = Join-Path $root 'src\trust.ts'
$CRLF = "`r`n"
# RecoveryModal.tsx is the one source file in the repo saved with bare LF, so anchors that span a
# line in it must not carry a carriage return.
$LF = "`n"

# 1. the write that took shop creation down, put back
Probe 'the wizard is caught writing the badge into its create payload again' $setup `
  "        showWhatsapp,${CRLF}        recoveryEmail," `
  "        phoneVerified: liveProven,${CRLF}        showWhatsapp,${CRLF}        recoveryEmail," `
  'the shop the wizard creates carries no badge of its own' $false

# 2. the update the rules would refuse, put back
Probe 'recovery is caught writing the badge alongside the contact number' $recovery `
  "          whatsapp: selectedCountry.dialCode.replace(/[^+\d]/g, '') + newPhone,${LF}        })" `
  "          whatsapp: selectedCountry.dialCode.replace(/[^+\d]/g, '') + newPhone,${LF}          phoneVerified: true,${LF}        })" `
  'the contact number the recovery flow changes is the only thing it writes' $false

# 3. the code sent under a name the endpoint never reads (the flow can only 400)
Probe 'recovery is caught submitting the code as otp instead of code' $recovery `
  '{ phone: getFullNewPhone(), code: phoneCode }' `
  '{ phone: getFullNewPhone(), otp: phoneCode }' `
  'the contact number the recovery flow changes is the only thing it writes' $false

# 4. the code on its way back to the browser
Probe 'the client is caught logging the code again' $recovery `
  "        setStep('phone-otp')" `
  "        if (data.debugOtp) console.log('[Recovery Debug] Code:', data.debugOtp)${LF}        setStep('phone-otp')" `
  'no code can reach the browser' $false

# 5. a value that merely looks true, made to count as a proof
Probe 'a truthy impostor is caught drawing a badge' $trust `
  '  if (trust?.phoneProven === true) return true' `
  '  if (trust?.phoneProven) return true' `
  'a value that merely looks true is not a proof' $true

# 6. the collection renamed on one side only -- every badge would go blank
Probe 'a collection renamed on one side only is caught' $trust `
  "export const TRUST_COLLECTION = 'trust'" `
  "export const TRUST_COLLECTION = 'trusted'" `
  'the collection the client reads is the one the server writes' $true

Write-Host "`nall 6 probes bit, and every file came back byte-exact"
