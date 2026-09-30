Add-Type -AssemblyName System.Speech

try {
  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
  $recognizer.SetInputToDefaultAudioDevice()
  $grammar = New-Object System.Speech.Recognition.DictationGrammar
  $recognizer.LoadGrammar($grammar)

  [Console]::WriteLine("READY|Windows Speech|1")
  [Console]::Out.Flush()

  $recognizer.add_SpeechRecognized({
    param($sender, $e)
    if ($e.Result -and $e.Result.Text) {
      $confidence = [Math]::Max(0.0, [Math]::Min(1.0, [double]$e.Result.Confidence))
      [Console]::WriteLine("TRANSCRIPT|$($e.Result.Text.Replace('|',' '))|$([Math]::Round($confidence,3))")
      [Console]::Out.Flush()
    }
  })

  $recognizer.add_AudioLevelUpdated({
    param($sender, $e)
    $level = [Math]::Max(0.0, [Math]::Min(1.0, [double]$e.AudioLevel / 100.0))
    [Console]::WriteLine("LEVEL|$([Math]::Round($level,3))|0")
    [Console]::Out.Flush()
  })

  $recognizer.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)

  while ($true) {
    $line = [Console]::ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim().ToUpperInvariant() -eq 'STOP') { break }
  }

  try { $recognizer.RecognizeAsyncCancel() } catch {}
  try { $recognizer.RecognizeAsyncStop() } catch {}
  $recognizer.Dispose()
  exit 0
}
catch {
  [Console]::WriteLine("SPEECH_ERROR|Windows speech recognition could not start: $($_.Exception.Message)|0")
  [Console]::Out.Flush()
  exit 1
}
