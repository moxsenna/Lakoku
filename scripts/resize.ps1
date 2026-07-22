Add-Type -AssemblyName System.Drawing

$src = "D:\0Project\Lakoku\logo.png"
$srcImg = [System.Drawing.Image]::FromFile($src)

function Resize-Img($img, $outPath, $maxW, $maxH) {
    $ratio = [Math]::Min($maxW / $img.Width, $maxH / $img.Height)
    if ($ratio -gt 1) { $ratio = 1 }
    $nw = [int]($img.Width * $ratio)
    $nh = [int]($img.Height * $ratio)
    
    $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($img, 0, 0, $nw, $nh)
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

# Resize logo to 180x180 max to guarantee under 50KB
Resize-Img $srcImg "d:\Coding\lakoku v2\public\logo.png" 180 180
Resize-Img $srcImg "d:\Coding\lakoku v2\public\icon.png" 180 180
Resize-Img $srcImg "d:\Coding\lakoku v2\public\favicon.png" 64 64
Resize-Img $srcImg "d:\Coding\lakoku v2\public\apple-icon.png" 180 180
Resize-Img $srcImg "d:\Coding\lakoku v2\app\favicon.ico" 64 64
Resize-Img $srcImg "d:\Coding\lakoku v2\public\favicon.ico" 64 64

$srcImg.Dispose()
