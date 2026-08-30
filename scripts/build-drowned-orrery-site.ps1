$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$siteRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "deploy\drowned-orrery-site"))
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $siteRoot "dist"))

if (-not $siteRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to build outside the project workspace."
}

if (Test-Path -LiteralPath $distRoot) {
  Remove-Item -LiteralPath $distRoot -Recurse -Force
}

$clientRoot = Join-Path $distRoot "client"
$serverRoot = Join-Path $distRoot "server"
New-Item -ItemType Directory -Force -Path $clientRoot, $serverRoot | Out-Null

Copy-Item -LiteralPath (Join-Path $projectRoot "games\drowned-orrery") -Destination (Join-Path $clientRoot "drowned-orrery") -Recurse
$goldSliceSource = Join-Path $projectRoot "games\drowned-orrery\models\gold-slice"
$goldSliceDeploy = Join-Path $clientRoot "drowned-orrery\models\gold-slice"
if (-not $goldSliceDeploy.StartsWith($distRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to prune gold-slice authoring files outside the deployment build."
}
if (Test-Path -LiteralPath $goldSliceDeploy) {
  Remove-Item -LiteralPath $goldSliceDeploy -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $goldSliceDeploy | Out-Null
foreach ($runtimeAsset in @("hero.glb", "sentinel.glb", "orrery_gate.glb", "manifest.json")) {
  Copy-Item -LiteralPath (Join-Path $goldSliceSource $runtimeAsset) -Destination (Join-Path $goldSliceDeploy $runtimeAsset)
}

New-Item -ItemType Directory -Force -Path (Join-Path $clientRoot "assets\vendor\three\examples\js\loaders") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $clientRoot "assets\vendor\three\examples\js\utils") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $clientRoot "assets\img\drowned-orrery") | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\vendor\three\three-r128.min.js") -Destination (Join-Path $clientRoot "assets\vendor\three\three-r128.min.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\vendor\three\LICENSE") -Destination (Join-Path $clientRoot "assets\vendor\three\LICENSE")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\vendor\three\examples\js\loaders\GLTFLoader.js") -Destination (Join-Path $clientRoot "assets\vendor\three\examples\js\loaders\GLTFLoader.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\vendor\three\examples\js\utils\SkeletonUtils.js") -Destination (Join-Path $clientRoot "assets\vendor\three\examples\js\utils\SkeletonUtils.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "assets\img\drowned-orrery\drowned-orrery-key-art.png") -Destination (Join-Path $clientRoot "assets\img\drowned-orrery\drowned-orrery-key-art.png")
Copy-Item -LiteralPath (Join-Path $projectRoot "deploy\drowned-orrery-worker.js") -Destination (Join-Path $serverRoot "index.js")

$sourceHtml = Get-Content -LiteralPath (Join-Path $projectRoot "games\drowned-orrery.html") -Raw -Encoding UTF8
$hostedHtml = $sourceHtml.Replace("../assets/", "assets/").Replace('href="../games.html"', 'href="/"')
[System.IO.File]::WriteAllText(
  (Join-Path $clientRoot "index.html"),
  $hostedHtml,
  [System.Text.UTF8Encoding]::new($false)
)

Write-Output "The Drowned Orrery deployment build is ready: $distRoot"
