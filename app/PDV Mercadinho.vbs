' PDV Mercadinho - abre como aplicativo
' Liga o servidor local escondido e abre a janela sem barra de navegador
Set sh = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
pasta = fs.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = pasta
url = "http://127.0.0.1:8080/"

If Not fs.FileExists(pasta & "\php\php.exe") Then
  MsgBox "Arquivos do PDV incompletos. Reinstale o PDV Mercadinho.", 48, "PDV Mercadinho"
  WScript.Quit
End If

' Gera o php.ini com o caminho real da pasta (funciona em qualquer lugar instalado)
Set ini = fs.CreateTextFile(pasta & "\php\php.ini", True)
ini.WriteLine "extension_dir=""" & pasta & "\php\ext"""
For Each e In Array("curl", "openssl", "pdo_sqlite", "sqlite3", "zip", "mbstring", "gd", "fileinfo", "soap")
  ini.WriteLine "extension=" & e
Next
ini.WriteLine "memory_limit=512M"
ini.WriteLine "upload_max_filesize=20M"
ini.WriteLine "post_max_size=20M"
ini.WriteLine "max_execution_time=120"
ini.WriteLine "date.timezone=America/Sao_Paulo"
ini.WriteLine "display_errors=Off"
If fs.FileExists(pasta & "\php\cacert.pem") Then
  ini.WriteLine "curl.cainfo=""" & pasta & "\php\cacert.pem"""
  ini.WriteLine "openssl.cafile=""" & pasta & "\php\cacert.pem"""
End If
ini.Close

' Liga o servidor (se já estiver ligado, este segundo só termina sozinho)
sh.Run """" & pasta & "\php\php.exe"" -c """ & pasta & "\php\php.ini"" -S 127.0.0.1:8080 -t """ & pasta & "\public""", 0, False

' Espera o servidor responder (até 10 segundos)
For i = 1 To 40
  ok = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.Open "GET", url & "index.html", False
  http.Send
  If Err.Number = 0 Then
    If http.Status = 200 Then ok = True
  End If
  Err.Clear
  On Error GoTo 0
  If ok Then Exit For
  WScript.Sleep 250
Next

' Abre em modo aplicativo (Edge vem em todo Windows 10/11; se não tiver, tenta Chrome)
perfil = pasta & "\dados\navegador"
args = " --app=" & url & " --user-data-dir=""" & perfil & """ --window-size=1366,768 --disable-features=Translate --kiosk-printing --no-first-run --no-default-browser-check"
On Error Resume Next
sh.Run "msedge" & args, 1, False
If Err.Number <> 0 Then
  Err.Clear
  sh.Run "chrome" & args, 1, False
  If Err.Number <> 0 Then sh.Run url
End If
