param(
  [Parameter(Mandatory = $true)]
  [string]$ZipPath,

  [string]$OutputDir,

  [string]$DataPath
)

$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot 'static\allsis\topics'
}

if (-not $DataPath) {
  $DataPath = Join-Path $repoRoot 'data\allsis.json'
}

$tmpRoot = Join-Path $repoRoot '.tmp_allsis_import'

function Assert-InsideRepo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($repoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify path outside repository: $fullPath"
  }

  return $fullPath
}

function Ensure-CleanDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }

  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Get-TopicSeries {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Title
  )

  $match = [regex]::Match($Title, '^\s*([^|｜丨︱]+?)\s*[|｜丨︱]')
  if ($match.Success) {
    return $match.Groups[1].Value.Trim()
  }

  return '全女评审团'
}

function Get-LocalTopicId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Seed
  )

  $sha1 = [System.Security.Cryptography.SHA1]::Create()

  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Seed)
    $hashBytes = $sha1.ComputeHash($bytes)
    $hash = ([System.BitConverter]::ToString($hashBytes) -replace '-', '').Substring(0, 12).ToLowerInvariant()
    return "local-$hash"
  } finally {
    $sha1.Dispose()
  }
}

function Get-PageTextInfo {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html
  )

  $text = ''
  $createdAt = ''
  $activityTimes = New-Object System.Collections.Generic.List[string]

  $jsonLdMatch = [regex]::Match(
    $Html,
    '<script type="application/ld\+json">\s*(\{[\s\S]*?\})\s*</script>',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  if ($jsonLdMatch.Success) {
    try {
      $jsonLd = $jsonLdMatch.Groups[1].Value | ConvertFrom-Json
      $text = [string]$jsonLd.text
      $createdAt = [string]$jsonLd.dateCreated
    } catch {
      $text = ''
      $createdAt = ''
    }
  }

  if (-not $createdAt) {
    $createTimeMatch = [regex]::Match($Html, '<span class="create-time">([^<]+)</span>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    if ($createTimeMatch.Success) {
      $createdAtTextMatch = [regex]::Match($createTimeMatch.Groups[1].Value, '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}')
      if ($createdAtTextMatch.Success) {
        $createdAt = $createdAtTextMatch.Value
      }
    }
  }

  if (-not $text) {
    $paragraphs = New-Object System.Collections.Generic.List[string]
    foreach ($paragraphMatch in [regex]::Matches($Html, '<p[^>]*>(.*?)</p>', [System.Text.RegularExpressions.RegexOptions]::Singleline)) {
      $paragraphText = [regex]::Replace($paragraphMatch.Groups[1].Value, '<[^>]+>', ' ')
      $paragraphText = [System.Net.WebUtility]::HtmlDecode($paragraphText)
      $paragraphText = [regex]::Replace($paragraphText, '\s+', ' ').Trim()

      if ($paragraphText) {
        [void]$paragraphs.Add($paragraphText)
      }

      if ($paragraphs.Count -ge 8) {
        break
      }
    }

    $text = $paragraphs -join ' '
  }

  $text = [regex]::Replace($text, '<[^>]+>', ' ')
  $text = [System.Net.WebUtility]::HtmlDecode($text)
  $text = [regex]::Replace($text, '\s+', ' ').Trim()

  foreach ($pubTimeMatch in [regex]::Matches($Html, '<span class="pubtime">([^<]+)</span>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    $pubTimeTextMatch = [regex]::Match($pubTimeMatch.Groups[1].Value, '\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}')
    if ($pubTimeTextMatch.Success) {
      [void]$activityTimes.Add($pubTimeTextMatch.Value)
    }
  }

  return [PSCustomObject]@{
    text = $text
    createdAt = $createdAt
    activityTimes = @($activityTimes)
  }
}

function Get-HtmlTitle {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html,

    [Parameter(Mandatory = $true)]
    [string]$FallbackTitle
  )

  $titleMatch = [regex]::Match($Html, '<title[^>]*>([\s\S]*?)</title>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($titleMatch.Success) {
    $title = [regex]::Replace($titleMatch.Groups[1].Value, '<[^>]+>', ' ')
    $title = [System.Net.WebUtility]::HtmlDecode($title)
    $title = [regex]::Replace($title, '\s+', ' ').Trim()

    if ($title) {
      return $title
    }
  }

  return [regex]::Replace($FallbackTitle, '\s+', ' ').Trim()
}

function Get-HtmlTopicId {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html
  )

  $topicIdMatch = [regex]::Match($Html, '/group/topic/(\d+)/', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if ($topicIdMatch.Success) {
    return $topicIdMatch.Groups[1].Value
  }

  return ''
}

function Get-TopicTextInfo {
  param(
    [Parameter(Mandatory = $true)]
    [object[]]$PageFiles
  )

  $segments = New-Object System.Collections.Generic.List[string]
  $createdAt = ''
  $activityMoments = New-Object System.Collections.Generic.List[datetime]

  foreach ($pageFile in $PageFiles) {
    $pageInfo = Get-PageTextInfo -Html (Get-Content -LiteralPath $pageFile.FullName -Encoding UTF8 -Raw)

    if ($pageInfo.text) {
      [void]$segments.Add([string]$pageInfo.text)
    }

    if (-not $createdAt -and $pageInfo.createdAt) {
      $createdAt = [string]$pageInfo.createdAt
    }

    foreach ($activityTime in $pageInfo.activityTimes) {
      try {
        [void]$activityMoments.Add((Get-Date ([string]$activityTime)))
      } catch {
      }
    }
  }

  $content = [regex]::Replace(($segments -join ' '), '\s+', ' ').Trim()
  $summary = $content

  if ($summary.Length -gt 160) {
    $summary = $summary.Substring(0, 160).Trim() + '…'
  }

  if ($activityMoments.Count -eq 0 -and $createdAt) {
    try {
      [void]$activityMoments.Add((Get-Date ([string]$createdAt)))
    } catch {
    }
  }

  $latestActivity = ''
  if ($activityMoments.Count -gt 0) {
    $latestActivity = ($activityMoments | Sort-Object -Descending | Select-Object -First 1).ToString('s')
  }

  return [PSCustomObject]@{
    summary = $summary
    content = $content
    createdAt = $createdAt
    latestActivity = $latestActivity
  }
}

function Rewrite-PaginatorLinks {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html,

    [Parameter(Mandatory = $true)]
    [string]$TopicId
  )

  if (-not $TopicId) {
    return $Html
  }

  return [regex]::Replace(
    $Html,
    '<div class="paginator">[\s\S]*?</div>',
    {
      param($match)

      [regex]::Replace(
        $match.Value,
        "https://www\.douban\.com/group/topic/$TopicId/[^""'<> ]*",
        {
          param($urlMatch)

          $normalized = $urlMatch.Value -replace '&amp;', '&'
          $pageIndex = 1
          $startMatch = [regex]::Match($normalized, '[?&]start=(\d+)')

          if ($startMatch.Success) {
            $pageIndex = [int]([int]$startMatch.Groups[1].Value / 100) + 1
          }

          return "/allsis/topics/$TopicId/$pageIndex/"
        }
      )
    },
    1
  )
}

function Get-ArchivePageUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TopicId,

    [Parameter(Mandatory = $true)]
    [int]$PageIndex
  )

  return "/allsis/topics/$TopicId/$PageIndex/"
}

function Publish-ArchivePage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [Parameter(Mandatory = $true)]
    [string]$DestinationDir,

    [Parameter(Mandatory = $true)]
    [int]$PageIndex,

    [Parameter(Mandatory = $true)]
    [string]$Html,

    [Parameter(Mandatory = $true)]
    [System.Text.Encoding]$Encoding
  )

  $pageDir = Join-Path $DestinationDir ([string]$PageIndex)
  New-Item -ItemType Directory -Path $pageDir -Force | Out-Null

  $indexPath = Join-Path $pageDir 'index.html'
  [System.IO.File]::WriteAllText($indexPath, $Html, $Encoding)
  Remove-Item -LiteralPath $SourcePath -Force
}

function Remove-RemoteScripts {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html
  )

  $cleaned = [regex]::Replace(
    $Html,
    '<script\b[^>]*\bsrc\s*=\s*["''][^"'']+["''][^>]*>[\s\S]*?</script>',
    '',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  $cleaned = [regex]::Replace(
    $cleaned,
    '<iframe\b[^>]*>[\s\S]*?</iframe>',
    '',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )

  return $cleaned
}

function Add-ArchiveBanner {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Html,

    [Parameter(Mandatory = $true)]
    [string]$ArchiveUrl,

    [string]$OriginalUrl
  )

  $safeArchiveUrl = [System.Net.WebUtility]::HtmlEncode($ArchiveUrl)
  $originalLinkMarkup = ''

  if ($OriginalUrl) {
    $safeOriginalUrl = [System.Net.WebUtility]::HtmlEncode($OriginalUrl)
    $originalLinkMarkup = "<a href=""$safeOriginalUrl"" style=""margin-left:12px;color:#285A48;font-weight:700;"" rel=""noopener noreferrer"" target=""_blank"">打开豆瓣原帖</a>"
  }

  $banner = @"
<div style="max-width:1040px;margin:18px auto 12px;padding:14px 16px;border:1px solid #cfe3d9;border-radius:16px;background:#eff8f3;color:#285A48;font:14px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
  <strong style="font-weight:700;">全女评审团存档</strong>
  <span>当前页面为本站保存的本地快照，分页已本地化。</span>
  <a href="$safeArchiveUrl" style="margin-left:12px;color:#285A48;font-weight:700;">返回文库</a>
  $originalLinkMarkup
</div>
"@

  return [regex]::Replace($Html, '<body([^>]*)>', "<body`$1>$banner", 1)
}

$ZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$OutputDir = Assert-InsideRepo -Path $OutputDir
$DataPath = Assert-InsideRepo -Path $DataPath
$tmpRoot = Assert-InsideRepo -Path $tmpRoot

Ensure-CleanDirectory -Path $tmpRoot
Ensure-CleanDirectory -Path $OutputDir
New-Item -ItemType Directory -Path (Split-Path -Parent $DataPath) -Force | Out-Null

try {
  Expand-Archive -LiteralPath $ZipPath -DestinationPath $tmpRoot -Force

  $archiveRoot = Get-ChildItem -LiteralPath $tmpRoot -Directory | Select-Object -First 1
  if (-not $archiveRoot) {
    throw "Archive root folder not found in zip: $ZipPath"
  }

  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  $items = @()

  Get-ChildItem -LiteralPath $archiveRoot.FullName -Directory | ForEach-Object {
    $topicDir = $_
    $metaPath = Join-Path $topicDir.FullName 'meta.json'
    $sourcePageFiles = @(Get-ChildItem -LiteralPath $topicDir.FullName -Filter '*.html' | Sort-Object `
      @{ Expression = {
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        if ($baseName -match '^\d+$') { [int]$baseName } else { [int]::MaxValue }
      } },
      @{ Expression = { $_.Name } }
    )

    if ((-not (Test-Path -LiteralPath $metaPath)) -and $sourcePageFiles.Count -eq 0) {
      return
    }

    if (Test-Path -LiteralPath $metaPath) {
      $meta = Get-Content -LiteralPath $metaPath -Encoding UTF8 -Raw | ConvertFrom-Json
    } else {
      $firstPageHtml = Get-Content -LiteralPath $sourcePageFiles[0].FullName -Encoding UTF8 -Raw
      $htmlTopicId = Get-HtmlTopicId -Html $firstPageHtml
      $savedAtFromFiles = ($sourcePageFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime

      $meta = [PSCustomObject]@{
        title = Get-HtmlTitle -Html $firstPageHtml -FallbackTitle $topicDir.Name
        link = if ($htmlTopicId) { "https://www.douban.com/group/topic/$htmlTopicId/" } else { '' }
        pages = $sourcePageFiles.Count
        saved_at = $savedAtFromFiles.ToString('s')
      }
    }

    $topicIdMatch = [regex]::Match([string]$meta.link, '/group/topic/(\d+)/')
    $topicId = if ($topicIdMatch.Success) {
      $topicIdMatch.Groups[1].Value
    } else {
      Get-LocalTopicId -Seed $topicDir.Name
    }
    $destinationDir = Join-Path $OutputDir $topicId
    New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null

    Get-ChildItem -LiteralPath $topicDir.FullName | ForEach-Object {
      if ($_.PSIsContainer -or $_.Name -ne 'meta.json') {
        Copy-Item -LiteralPath $_.FullName -Destination $destinationDir -Recurse -Force
      }
    }

    $topicPageFiles = @(Get-ChildItem -LiteralPath $destinationDir -Filter '*.html' | Sort-Object `
      @{ Expression = {
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
        if ($baseName -match '^\d+$') { [int]$baseName } else { [int]::MaxValue }
      } },
      @{ Expression = { $_.Name } }
    )

    $summaryInfo = if ($topicPageFiles.Count -gt 0) {
      Get-TopicTextInfo -PageFiles $topicPageFiles
    } else {
      [PSCustomObject]@{
        summary = ''
        content = ''
        createdAt = ''
        latestActivity = ''
      }
    }

    $topicPageFiles | ForEach-Object {
      $pagePath = $_.FullName
      $baseName = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
      $pageIndex = if ($baseName -match '^\d+$') { [int]$baseName } else { 1 }
      $html = Get-Content -LiteralPath $pagePath -Encoding UTF8 -Raw
      $html = Rewrite-PaginatorLinks -Html $html -TopicId $topicId
      $html = Remove-RemoteScripts -Html $html
      $html = Add-ArchiveBanner -Html $html -ArchiveUrl '/allsis/' -OriginalUrl ([string]$meta.link)
      Publish-ArchivePage -SourcePath $pagePath -DestinationDir $destinationDir -PageIndex $pageIndex -Html $html -Encoding $utf8NoBom
    }

    $savedAt = Get-Date ([string]$meta.saved_at)
    $createdAtDisplay = ''
    $createdAtIso = ''
    $lastActivityDisplay = ''
    $lastActivityIso = ''

    if ($summaryInfo.createdAt) {
      try {
        $createdDate = Get-Date ([string]$summaryInfo.createdAt)
        $createdAtDisplay = $createdDate.ToString('yyyy.MM.dd')
        $createdAtIso = $createdDate.ToString('s')
      } catch {
        $createdAtDisplay = ''
        $createdAtIso = ''
      }
    }

    if ($summaryInfo.latestActivity) {
      try {
        $latestActivityDate = Get-Date ([string]$summaryInfo.latestActivity)
        $lastActivityDisplay = $latestActivityDate.ToString('yyyy.MM.dd')
        $lastActivityIso = $latestActivityDate.ToString('s')
      } catch {
        $lastActivityDisplay = ''
        $lastActivityIso = ''
      }
    }

    $items += [ordered]@{
      topicId = $topicId
      title = [string]$meta.title
      series = Get-TopicSeries -Title ([string]$meta.title)
      pages = [int]$meta.pages
      summary = [string]$summaryInfo.summary
      content = [string]$summaryInfo.content
      originalLink = if ([string]$meta.link) { [string]$meta.link } else { '' }
      localUrl = Get-ArchivePageUrl -TopicId $topicId -PageIndex 1
      savedAt = $savedAt.ToString('s')
      savedAtDisplay = $savedAt.ToString('yyyy.MM.dd')
      createdAt = $createdAtIso
      createdAtDisplay = $createdAtDisplay
      lastActivityAt = $lastActivityIso
      lastActivityAtDisplay = $lastActivityDisplay
    }
  }

  $sortedItems = $items | Sort-Object `
    @{ Expression = { if ($_.lastActivityAt) { $_.lastActivityAt } elseif ($_.createdAt) { $_.createdAt } else { $_.savedAt } }; Descending = $true }, `
    @{ Expression = { [string]$_.topicId }; Descending = $true }

  $latestSaved = $sortedItems | Sort-Object savedAt -Descending | Select-Object -First 1
  $export = [ordered]@{
    groupName = '全女评审团'
    slug = 'allsis'
    groupUrl = 'https://www.douban.com/group/762437/'
    archiveCount = $sortedItems.Count
    multiPageCount = @($sortedItems | Where-Object { $_.pages -gt 1 }).Count
    importedAt = (Get-Date).ToString('o')
    importedAtDisplay = (Get-Date).ToString('yyyy.MM.dd')
    latestSavedAt = if ($latestSaved) { $latestSaved.savedAt } else { '' }
    latestSavedAtDisplay = if ($latestSaved) { $latestSaved.savedAtDisplay } else { '' }
    items = @($sortedItems)
  }

  $json = $export | ConvertTo-Json -Depth 5
  [System.IO.File]::WriteAllText($DataPath, $json, $utf8NoBom)
} finally {
  if (Test-Path -LiteralPath $tmpRoot) {
    Remove-Item -LiteralPath $tmpRoot -Recurse -Force
  }
}
