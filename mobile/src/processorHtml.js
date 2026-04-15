// Self-contained HTML that runs inside a hidden WebView.
// It receives image data + params via injectJavaScript, processes everything
// using Canvas (unavailable in React Native), and posts results back.

// Backtick char (96) and backslash char (92) are built at runtime to avoid
// string-literal escaping issues in this JS template string.

export const processorHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script>
// ─── helpers ────────────────────────────────────────────────────────────────
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function convolve(imageData, kernel, offset) {
  offset = offset || 0;
  var width = imageData.width, height = imageData.height, data = imageData.data;
  var kSize = kernel.length, kHalf = Math.floor(kSize / 2);
  var out = new Uint8ClampedArray(data);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      var r = 0, g = 0, b = 0;
      for (var ky = 0; ky < kSize; ky++) {
        for (var kx = 0; kx < kSize; kx++) {
          var px = Math.min(Math.max(x + kx - kHalf, 0), width - 1);
          var py = Math.min(Math.max(y + ky - kHalf, 0), height - 1);
          var i = (py * width + px) * 4;
          var w = kernel[ky][kx];
          r += data[i] * w; g += data[i+1] * w; b += data[i+2] * w;
        }
      }
      var i2 = (y * width + x) * 4;
      out[i2]   = clamp(r + offset);
      out[i2+1] = clamp(g + offset);
      out[i2+2] = clamp(b + offset);
    }
  }
  return new ImageData(out, width, height);
}

// ─── filters ────────────────────────────────────────────────────────────────
function applyBlur(id, p) {
  var r = Math.max(1, Math.floor(p.radius));
  var W = id.width, H = id.height, src = id.data;
  var tmp = new Float32Array(W * H * 4);
  var out = new Uint8ClampedArray(src);
  var hps = new Float64Array(W + 1);
  for (var y = 0; y < H; y++) {
    for (var c = 0; c < 3; c++) {
      hps.fill(0);
      for (var x = 0; x < W; x++) hps[x+1] = hps[x] + src[(y*W+x)*4+c];
      for (x = 0; x < W; x++) {
        var x0 = Math.max(0,x-r), x1 = Math.min(W-1,x+r);
        tmp[(y*W+x)*4+c] = (hps[x1+1]-hps[x0])/(x1-x0+1);
      }
    }
  }
  var vps = new Float64Array(H + 1);
  for (var x2 = 0; x2 < W; x2++) {
    for (var c2 = 0; c2 < 3; c2++) {
      vps.fill(0);
      for (var y2 = 0; y2 < H; y2++) vps[y2+1] = vps[y2] + tmp[(y2*W+x2)*4+c2];
      for (y2 = 0; y2 < H; y2++) {
        var y0 = Math.max(0,y2-r), y1 = Math.min(H-1,y2+r);
        out[(y2*W+x2)*4+c2] = clamp((vps[y1+1]-vps[y0])/(y1-y0+1));
      }
    }
  }
  return new ImageData(out, W, H);
}

function applySharpen(id, p) {
  var a = p.amount;
  return convolve(id, [[0,-a,0],[-a,1+4*a,-a],[0,-a,0]]);
}

function applyPixelate(id, p) {
  var s = Math.max(2, Math.floor(p.size));
  var W = id.width, H = id.height, src = id.data;
  var out = new Uint8ClampedArray(src);
  for (var y = 0; y < H; y += s) {
    for (var x = 0; x < W; x += s) {
      var rS=0,gS=0,bS=0,cnt=0;
      for (var dy=0; dy<s && y+dy<H; dy++) {
        for (var dx=0; dx<s && x+dx<W; dx++) {
          var i=((y+dy)*W+(x+dx))*4;
          rS+=src[i]; gS+=src[i+1]; bS+=src[i+2]; cnt++;
        }
      }
      var rv=clamp(rS/cnt),gv=clamp(gS/cnt),bv=clamp(bS/cnt);
      for (dy=0; dy<s && y+dy<H; dy++) {
        for (dx=0; dx<s && x+dx<W; dx++) {
          var j=((y+dy)*W+(x+dx))*4;
          out[j]=rv; out[j+1]=gv; out[j+2]=bv;
        }
      }
    }
  }
  return new ImageData(out, W, H);
}

function applyPosterize(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  var step=255/(Math.max(2,p.levels)-1);
  for (var i=0;i<W*H*4;i+=4) {
    out[i]  =clamp(Math.round(src[i]  /step)*step);
    out[i+1]=clamp(Math.round(src[i+1]/step)*step);
    out[i+2]=clamp(Math.round(src[i+2]/step)*step);
  }
  return new ImageData(out,W,H);
}

function applyThreshold(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  for (var i=0;i<W*H*4;i+=4) {
    var lum=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
    var v=lum>=p.value?255:0;
    out[i]=out[i+1]=out[i+2]=v;
  }
  return new ImageData(out,W,H);
}

function applyGrayscale(id) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  for (var i=0;i<W*H*4;i+=4) {
    var v=clamp(0.299*src[i]+0.587*src[i+1]+0.114*src[i+2]);
    out[i]=out[i+1]=out[i+2]=v;
  }
  return new ImageData(out,W,H);
}

function applyEdgeDetect(id) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  var Gx=[[-1,0,1],[-2,0,2],[-1,0,1]];
  var Gy=[[-1,-2,-1],[0,0,0],[1,2,1]];
  for (var y=1;y<H-1;y++) {
    for (var x=1;x<W-1;x++) {
      var rx=0,gx=0,bx=0,ry=0,gy=0,by=0;
      for (var ky=0;ky<3;ky++) {
        for (var kx=0;kx<3;kx++) {
          var i=((y+ky-1)*W+(x+kx-1))*4;
          rx+=src[i]*Gx[ky][kx];   ry+=src[i]*Gy[ky][kx];
          gx+=src[i+1]*Gx[ky][kx]; gy+=src[i+1]*Gy[ky][kx];
          bx+=src[i+2]*Gx[ky][kx]; by+=src[i+2]*Gy[ky][kx];
        }
      }
      var j=(y*W+x)*4;
      out[j]  =clamp(Math.sqrt(rx*rx+ry*ry));
      out[j+1]=clamp(Math.sqrt(gx*gx+gy*gy));
      out[j+2]=clamp(Math.sqrt(bx*bx+by*by));
    }
  }
  return new ImageData(out,W,H);
}

function applyEmboss(id) {
  return convolve(id,[[-2,-1,0],[-1,1,1],[0,1,2]],128);
}

function applyDitherFloyd(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var L=Math.max(2,Math.floor(p.levels));
  var step=255/(L-1);
  var gray=new Float32Array(W*H);
  for (var i=0;i<W*H;i++) gray[i]=0.299*src[i*4]+0.587*src[i*4+1]+0.114*src[i*4+2];
  for (var y=0;y<H;y++) {
    for (var x=0;x<W;x++) {
      var idx=y*W+x;
      var old=gray[idx];
      var nv=Math.round(old/step)*step;
      var err=old-nv;
      gray[idx]=nv;
      if (x+1<W)          gray[idx+1]      +=err*7/16;
      if (y+1<H) {
        if (x>0)           gray[idx+W-1]    +=err*3/16;
                           gray[idx+W]      +=err*5/16;
        if (x+1<W)        gray[idx+W+1]    +=err*1/16;
      }
    }
  }
  var out=new Uint8ClampedArray(src);
  for (var k=0;k<W*H;k++) {
    var v=clamp(gray[k]);
    out[k*4]=v; out[k*4+1]=v; out[k*4+2]=v;
  }
  return new ImageData(out,W,H);
}

function applyDitherOrdered(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var L=Math.max(2,Math.floor(p.levels));
  var step=255/(L-1);
  var bayer=[
    [0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],
    [12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],
    [3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],
    [15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]
  ];
  var out=new Uint8ClampedArray(src);
  for (var y=0;y<H;y++) {
    for (var x=0;x<W;x++) {
      var i=(y*W+x)*4;
      var thr=(bayer[y%8][x%8]/64-0.5)*step;
      var lum=0.299*src[i]+0.587*src[i+1]+0.114*src[i+2];
      var v=clamp(Math.round((lum+thr)/step)*step);
      out[i]=v; out[i+1]=v; out[i+2]=v;
    }
  }
  return new ImageData(out,W,H);
}

function applyNoise(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  for (var i=0;i<W*H*4;i+=4) {
    var h=((Math.sin((i/4)*127.1+311.7)*43758.5453)%1);
    var n=(h-0.5)*p.amount*2;
    out[i]  =clamp(src[i]  +n);
    out[i+1]=clamp(src[i+1]+n);
    out[i+2]=clamp(src[i+2]+n);
  }
  return new ImageData(out,W,H);
}

function applyVignette(id, p) {
  var W=id.width,H=id.height,src=id.data;
  var out=new Uint8ClampedArray(src);
  var cx=W/2,cy=H/2,md=Math.sqrt(cx*cx+cy*cy);
  for (var y=0;y<H;y++) {
    for (var x=0;x<W;x++) {
      var d=Math.sqrt((x-cx)*(x-cx)+(y-cy)*(y-cy))/md;
      var f=Math.max(0,1-d*d*p.strength);
      var i=(y*W+x)*4;
      out[i]  =clamp(src[i]  *f);
      out[i+1]=clamp(src[i+1]*f);
      out[i+2]=clamp(src[i+2]*f);
    }
  }
  return new ImageData(out,W,H);
}

function applyFilters(img, filters) {
  if (filters.blur.enabled)          img=applyBlur(img,          filters.blur);
  if (filters.sharpen.enabled)       img=applySharpen(img,       filters.sharpen);
  if (filters.pixelate.enabled)      img=applyPixelate(img,      filters.pixelate);
  if (filters.posterize.enabled)     img=applyPosterize(img,     filters.posterize);
  if (filters.threshold.enabled)     img=applyThreshold(img,     filters.threshold);
  if (filters.grayscale.enabled)     img=applyGrayscale(img);
  if (filters.edgeDetect.enabled)    img=applyEdgeDetect(img);
  if (filters.emboss.enabled)        img=applyEmboss(img);
  if (filters.ditherFloyd.enabled)   img=applyDitherFloyd(img,   filters.ditherFloyd);
  if (filters.ditherOrdered.enabled) img=applyDitherOrdered(img, filters.ditherOrdered);
  if (filters.noise.enabled)         img=applyNoise(img,         filters.noise);
  if (filters.vignette.enabled)      img=applyVignette(img,      filters.vignette);
  return img;
}

// ─── ASCII converter ─────────────────────────────────────────────────────────
var BT = String.fromCharCode(96); // backtick — avoids escaping issues
var CHAR_SETS = {
  standard: " .'" + BT + "^\\\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  simple:   " .:-=+*#%@",
  blocks:   " \u2591\u2592\u2593\u2588",
  binary:   " @",
  detailed: " .'\"^" + BT + ",:;Il!i<>~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  braille:  " \u2801\u2802\u2803\u2804\u2805\u2806\u2807\u2808\u2809\u280a\u280b\u280c\u280d\u280e\u280f\u2810\u2811\u2812\u2813\u2814\u2815\u2816\u2817\u2818\u2819\u281a\u281b\u281c\u281d\u281e\u281f\u2820\u2821\u2822\u2823\u2824\u2825\u2826\u2827\u2828\u2829\u282a\u282b\u282c\u282d\u282e\u282f\u2830\u2831\u2832\u2833\u2834\u2835\u2836\u2837\u2838\u2839\u283a\u283b\u283c\u283d\u283e\u283f"
};

function adjBC(v, br, co) {
  v = v + br * 2.55;
  var f = (259*(co+255))/(255*(259-co));
  return Math.max(0, Math.min(255, f*(v-128)+128));
}

function imageToAscii(imageData, params) {
  var chars = CHAR_SETS[params.charSet] || CHAR_SETS.standard;
  var srcW = imageData.width, srcH = imageData.height;
  var outW = params.width;
  var outH = Math.round(outW * (srcH/srcW) * 0.45);
  var cellW = srcW/outW, cellH = srcH/outH;
  var lines = [];
  var data = imageData.data;
  var br = params.brightness || 0, co = params.contrast || 0;
  var inv = params.invert || false;

  for (var row=0; row<outH; row++) {
    var line = "";
    var x0f, y0f, x1f, y1f, rT, gT, bT, cnt;
    for (var col=0; col<outW; col++) {
      x0f=Math.floor(col*cellW); y0f=Math.floor(row*cellH);
      x1f=Math.min(Math.ceil((col+1)*cellW),srcW);
      y1f=Math.min(Math.ceil((row+1)*cellH),srcH);
      rT=0; gT=0; bT=0; cnt=0;
      for (var py=y0f;py<y1f;py++) {
        for (var px=x0f;px<x1f;px++) {
          var idx=(py*srcW+px)*4;
          rT+=data[idx]; gT+=data[idx+1]; bT+=data[idx+2]; cnt++;
        }
      }
      if (!cnt) cnt=1;
      var r=adjBC(rT/cnt,br,co), g=adjBC(gT/cnt,br,co), b2=adjBC(bT/cnt,br,co);
      var lum=0.299*r+0.587*g+0.114*b2;
      var t=lum/255; if (inv) t=1-t;
      line += chars[Math.floor(t*(chars.length-1))];
    }
    lines.push(line);
  }
  return lines;
}

function renderPng(lines, params) {
  var fontSize = params.fontSize || 10;
  var bgColor  = params.bgColor  || "#000000";
  var fgColor  = params.fgColor  || "#00ff41";
  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d");
  ctx.font = fontSize + "px monospace";
  var cw = ctx.measureText("M").width;
  var lh = fontSize * 1.2;
  canvas.width  = Math.ceil((lines[0] ? lines[0].length : 0) * cw);
  canvas.height = Math.ceil(lines.length * lh);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.font = fontSize + "px monospace";
  ctx.fillStyle = fgColor;
  ctx.textBaseline = "top";
  for (var i=0;i<lines.length;i++) ctx.fillText(lines[i], 0, i*lh);
  return canvas.toDataURL("image/png");
}

// ─── message handling ────────────────────────────────────────────────────────
var lastLines = null;

function postBack(obj) {
  window.ReactNativeWebView.postMessage(JSON.stringify(obj));
}

function processImage(base64, mime, params, filters) {
  var img = new Image();
  img.onload = function() {
    var MAX = 1200;
    var sw = img.width, sh = img.height;
    var scale = Math.min(1, MAX/Math.max(sw,sh));
    var w = Math.round(sw*scale), h = Math.round(sh*scale);
    var canvas = document.createElement("canvas");
    canvas.width=w; canvas.height=h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img,0,0,w,h);
    var imageData = ctx.getImageData(0,0,w,h);
    var filtered  = applyFilters(imageData, filters);
    var lines     = imageToAscii(filtered, params);
    lastLines = lines;
    postBack({ type:"result", lines:lines });
  };
  img.onerror = function() { postBack({ type:"error", msg:"Failed to load image" }); };
  img.src = "data:" + mime + ";base64," + base64;
}

function doExportPng(params) {
  if (!lastLines) return postBack({ type:"error", msg:"No result yet" });
  postBack({ type:"exportPng", dataUrl: renderPng(lastLines, params) });
}

function handleMsg(raw) {
  try {
    var msg = JSON.parse(raw);
    if (msg.type === "process")    processImage(msg.b64, msg.mime, msg.params, msg.filters);
    else if (msg.type === "export") doExportPng(msg.params);
  } catch(e) { postBack({ type:"error", msg: String(e) }); }
}

// Android posts to document, iOS to window
document.addEventListener("message", function(e){ handleMsg(e.data); });
window.addEventListener("message",   function(e){ handleMsg(e.data); });
</script>
</head>
<body></body>
</html>`;
