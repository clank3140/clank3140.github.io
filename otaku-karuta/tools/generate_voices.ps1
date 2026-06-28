<#
.SYNOPSIS
  VOICEVOX を使って data/memes.json の上の句を一括で読み上げ音声(WAV)に変換する。

.DESCRIPTION
  ハードモード（上の句を音声で出題）用の音声ファイルを生成する。
  出力先: otaku-karuta/assets/audio/{id}.wav

.PREREQUISITE
  1. VOICEVOX (https://voicevox.hiroshiba.jp/) をインストールして起動しておく。
     起動するとローカルに音声合成エンジンが立ち上がる（既定: http://127.0.0.1:50021）。
  2. PowerShell から本スクリプトを実行する:
       pwsh -File otaku-karuta/tools/generate_voices.ps1
     （話者を変える場合: pwsh -File ... -Speaker 2  など）

.LICENSE / COMPLIANCE
  VOICEVOX は無料で商用・非商用利用が可能。生成音声を公開する際は、使用した
  キャラクターのクレジット表記（例: 「VOICEVOX:ずんだもん」）が必要。
  Speaker を変更したら index.html のクレジット表記も合わせて更新すること。
  キャラごとの細かな利用規約は各キャラクターの公式ページで確認すること。
#>
param(
  [string]$Engine  = 'http://127.0.0.1:50021',
  [int]   $Speaker = 3   # 3 = ずんだもん(ノーマル)。話者一覧は GET $Engine/speakers で確認できる
)

$ErrorActionPreference = 'Stop'

$Root     = Split-Path -Parent $PSScriptRoot   # → otaku-karuta/
$DataPath = Join-Path $Root 'data/memes.json'
$OutDir   = Join-Path $Root 'assets/audio'

if (-not (Test-Path $DataPath)) { throw "memes.json が見つかりません: $DataPath" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# エンジンの疎通確認
try { Invoke-RestMethod -Method Get -Uri "$Engine/version" -TimeoutSec 5 | Out-Null }
catch { throw "VOICEVOX エンジンに接続できません ($Engine)。VOICEVOX を起動してから再実行してください。" }

$memes = Get-Content -Raw -Encoding utf8 $DataPath | ConvertFrom-Json
$count = 0

foreach ($m in $memes) {
  # 読みが崩れる問だけ memes.json に "reading" を足せば、そちらを優先して読む（任意）
  $text = if ($m.reading) { $m.reading } else { $m.kami }
  $enc  = [uri]::EscapeDataString($text)
  $out  = Join-Path $OutDir ("{0}.wav" -f $m.id)

  # 1) 音声クエリ生成（テキスト・話者はクエリパラメータで渡す）
  $query = Invoke-RestMethod -Method Post -Uri "$Engine/audio_query?speaker=$Speaker&text=$enc"
  $body  = $query | ConvertTo-Json -Depth 30 -Compress

  # 2) 音声合成（WAV バイナリ）。-OutFile でそのままバイナリ保存する
  #    （Windows PowerShell 5.1 では .Content が文字列化されるため -OutFile を使う）
  Invoke-WebRequest -Method Post -Uri "$Engine/synthesis?speaker=$Speaker" `
    -Body $body -ContentType 'application/json' -OutFile $out | Out-Null

  $count++
  Write-Host ("OK  id={0,-3}  {1}" -f $m.id, $text)
}

Write-Host ""
Write-Host ("完了: {0} 件の音声を生成しました → {1}" -f $count, $OutDir)
Write-Host "クレジット表記『VOICEVOX:ずんだもん』(話者を変えた場合はそのキャラ名) を必ずサイトに記載してください。"

# --- 任意: ffmpeg があれば MP3 に変換してサイズを削減できる ---------------
#   Get-ChildItem (Join-Path $OutDir '*.wav') | ForEach-Object {
#     ffmpeg -y -i $_.FullName ($_.FullName -replace '\.wav$', '.mp3')
#   }
#   変換した場合は js/game.js の AUDIO_EXT を 'mp3' に変更すること。
