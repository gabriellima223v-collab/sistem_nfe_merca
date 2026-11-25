; Instalador do PDV Mercadinho (Inno Setup 6)
#define AppNome "PDV Mercadinho"
#ifndef AppVersao
  #define AppVersao "1.0"
#endif

[Setup]
AppId={{7F3C2B1A-9D4E-4C8B-A1F2-5E6D7C8B9A01}
AppName={#AppNome}
AppVersion={#AppVersao}
AppPublisher=EXECORA
DefaultDirName=C:\PDV
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\saida
OutputBaseFilename=PDV-Mercadinho-Setup
SetupIconFile=..\public\icone.ico
UninstallDisplayIcon={app}\public\icone.ico
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "pt"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "..\public\*"; DestDir: "{app}\public"; Flags: recursesubdirs ignoreversion
Source: "..\app\*"; DestDir: "{app}\app"; Flags: recursesubdirs ignoreversion
Source: "..\vendor\*"; DestDir: "{app}\vendor"; Flags: recursesubdirs ignoreversion skipifsourcedoesntexist
Source: "..\build\php\*"; DestDir: "{app}\php"; Flags: recursesubdirs ignoreversion
Source: "..\PDV Mercadinho.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\Desligar servidor.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LEIA-ME.txt"; DestDir: "{app}"; Flags: ignoreversion
; a pasta "dados" (vendas, produtos, certificado) nunca é sobrescrita nem apagada

[Icons]
Name: "{userdesktop}\{#AppNome}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PDV Mercadinho.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\icone.ico"
Name: "{userstartup}\{#AppNome}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PDV Mercadinho.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\icone.ico"
Name: "{userprograms}\{#AppNome}"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\PDV Mercadinho.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\public\icone.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\PDV Mercadinho.vbs"""; Description: "Abrir o PDV agora"; Flags: postinstall nowait skipifsilent

[InstallDelete]
Type: files; Name: "{app}\php\php.ini"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/f /im php.exe"; Flags: runhidden; RunOnceId: "DesligaPHP"

[Code]
// Desliga o servidor antes de atualizar uma instalação existente
function PrepareToInstall(var NeedsRestart: Boolean): String;
var R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im php.exe', '', SW_HIDE, ewWaitUntilTerminated, R);
  Result := '';
end;
