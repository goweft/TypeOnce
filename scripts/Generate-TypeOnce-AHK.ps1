# Generate-TypeOnce-AHK.ps1
# Fetches all triggers from the TypeOnce server and generates a complete
# AutoHotkey v2 script. Triggers that declare `inputs` prompt for them via
# InputBox dialogs before expanding; triggers without inputs expand directly.
#
# Run on Windows:
#   powershell -ExecutionPolicy Bypass -File .\Generate-TypeOnce-AHK.ps1
# Then double-click the generated TypeOnce-Complete.ahk (AutoHotkey v2 required).

$ServerURL  = "http://192.168.7.130:8091"   # CHANGE to your server IP if different
$OutputFile = "TypeOnce-Complete.ahk"

# Escape a string for embedding inside an AHK *single-quoted* literal: backtick is
# AHK's escape char, and a single quote inside a single-quoted string becomes `'.
function Esc-Ahk($s) {
    if ($null -eq $s) { return "" }
    $t = [string]$s
    $t = $t -replace '`', '``'
    $t = $t -replace "'", "``'"
    return $t
}

try {
    $triggers = Invoke-RestMethod -Uri "$ServerURL/triggers" -Method GET
}
catch {
    Write-Host "ERROR: could not reach TypeOnce at $ServerURL/triggers" -ForegroundColor Red
    Write-Host "Make sure the server is running and reachable from Windows." -ForegroundColor Red
    Write-Host "Test with:  curl $ServerURL/triggers" -ForegroundColor Yellow
    exit 1
}
$triggers = @($triggers)

# --- Static AHK helpers (verbatim; literal here-string so backticks survive) ---
$helpers = @'

; --- Pull the "result" string out of the JSON response, honoring \-escapes ---
GetResult(json) {
    needle := '"result":"'
    p := InStr(json, needle)
    if (!p)
        return ''
    i := p + StrLen(needle)
    out := ''
    total := StrLen(json)
    while (i <= total) {
        ch := SubStr(json, i, 1)
        if (ch = '\') {
            nx := SubStr(json, i + 1, 1)
            switch nx {
                case 'n': out .= '`n'
                case 'r': out .= '`r'
                case 't': out .= '`t'
                case '"': out .= '"'
                case '\': out .= '\'
                case '/': out .= '/'
                default: out .= nx
            }
            i += 2
        } else if (ch = '"') {
            break
        } else {
            out .= ch
            i += 1
        }
    }
    return out
}

JsonEscape(s) {
    s := StrReplace(s, '\', '\\')
    s := StrReplace(s, '"', '\"')
    s := StrReplace(s, '`n', '\n')
    s := StrReplace(s, '`r', '\r')
    s := StrReplace(s, '`t', '\t')
    return s
}

ExpandTrigger(trigger) {
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", SERVER_URL . "/expand", false)
        req.SetRequestHeader("Content-Type", "application/json")
        req.Send('{"trigger":"' . trigger . '"}')
        return GetResult(req.ResponseText)
    }
    return ''
}

ExpandWithInputs(trigger, inputs) {
    payload := '{"trigger":"' . trigger . '","inputs":{'
    first := true
    for k, v in inputs {
        if (!first)
            payload .= ','
        payload .= '"' . k . '":"' . JsonEscape(v) . '"'
        first := false
    }
    payload .= '}}'
    try {
        req := ComObject("WinHttp.WinHttpRequest.5.1")
        req.Open("POST", SERVER_URL . "/expand", false)
        req.SetRequestHeader("Content-Type", "application/json")
        req.Send(payload)
        return GetResult(req.ResponseText)
    }
    return ''
}
'@

# --- Per-trigger hotstrings ---
$blocks = ""
$inputCount = 0
foreach ($t in $triggers) {
    $fields = @($t.inputs)
    if ($fields.Count -gt 0) {
        $inputCount++
        $n = $fields.Count
        $blocks += @"

; $($t.label) [$($t.packId)] -- prompts for $n input(s)
:*:$($t.key)::
{
    inputs := Map()
"@
        $i = 0
        foreach ($f in $fields) {
            $i++
            $p = Esc-Ahk $f.prompt
            $d = Esc-Ahk $f.default
            if ($f.type -eq 'select' -and $f.options) {
                $opts = (@($f.options) | ForEach-Object { Esc-Ahk $_ }) -join ' / '
                $p = "$p (choose: $opts)"
            }
            $blocks += @"

    res$i := InputBox('$p', 'TypeOnce: $($t.key)  ($i/$n)', 'w460 h170', '$d')
    if (res$i.Result = "Cancel")
        return
    inputs["$($f.name)"] := res$i.Value
"@
        }
        $blocks += @"

    out := ExpandWithInputs("$($t.key)", inputs)
    if (out != "")
        SendText(out)
}
"@
    }
    else {
        $blocks += @"

; $($t.label) [$($t.packId)]
:*:$($t.key)::
{
    out := ExpandTrigger("$($t.key)")
    if (out != "")
        SendText(out)
}
"@
    }
}

# --- Assemble ---
$header = @"
#Requires AutoHotkey v2.0
#SingleInstance Force

; TypeOnce AutoHotkey Integration - Auto-generated
; Generated: $(Get-Date)
; Total triggers: $($triggers.Count)   |   With input prompts: $inputCount

SERVER_URL := "$ServerURL"
"@

$hotkeys = @"


; === HOTKEYS ===
; Win+R         reload this script
#r::Reload()
; Win+Shift+T   open an SSH session to the TypeOnce box
#+t::Run("wt ssh gostev@192.168.7.130")
"@

$ahk = $header + $helpers + $blocks + $hotkeys
$ahk | Out-File -FilePath $OutputFile -Encoding UTF8

Write-Host "SUCCESS: wrote $OutputFile" -ForegroundColor Green
Write-Host "  Total triggers:      $($triggers.Count)" -ForegroundColor Cyan
Write-Host "  With input prompts:  $inputCount" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "  1. Ensure AutoHotkey v2 is installed."
Write-Host "  2. Double-click $OutputFile to run."
Write-Host "  3. Update SERVER_URL at the top if your server IP changed."
