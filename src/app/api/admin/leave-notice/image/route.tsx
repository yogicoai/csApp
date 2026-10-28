import { ImageResponse } from "next/og";
import { requireAdmin } from "@/lib/adminAuth";
import { bodyLines, HEADSET_SVG, NOTICE_COLORS, YOGIBO_LOGO_URL } from "@/lib/leaveNotice";
import { findNoticePeriod, getNoticeSettings, noticeQrSvg } from "@/lib/leaveNoticeServer";

// 휴무 팝업 이미지(PNG) — 톡톡·카카오 공지에 올릴 그림. ?id=<휴무 기간 id | sample(예시)>
// 글꼴은 Google Fonts 의 Noto Sans KR 을 그 이미지에 쓰는 글자만 받아 쓴다(ImageResponse 는 woff2 를 못 읽어 ttf).
const WIDTH = 720;

async function loadFont(weight: 400 | 800, text: string) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`,
  ).then((response) => response.text());
  const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font css");
  const response = await fetch(url);
  if (!response.ok) throw new Error("font file");
  return response.arrayBuffer();
}

async function dataUri(url: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) return "";
    const type = response.headers.get("content-type") ?? "image/png";
    return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
  } catch {
    return "";
  }
}

const svgUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

// 글자 수로 줄 수를 어림해 그림 높이를 정한다(넘치면 잘리지 않게 넉넉히).
function estimateHeight(lines: string[], notes: string[]) {
  const bodyRows = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 30)), 0);
  const noteRows = notes.reduce((sum, note) => sum + Math.max(1, Math.ceil(note.length / 40)), 0);
  return Math.max(WIDTH, 40 + 48 + 124 + bodyRows * 37 + 92 + noteRows * 25 + notes.length * 6 + 130 + 30);
}

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const settings = await getNoticeSettings();
  const period = await findNoticePeriod(settings, id);
  if (!period) return Response.json({ error: "휴무 기간을 찾을 수 없어요." }, { status: 404 });

  const lines = bodyLines(settings, period);
  const notes = settings.notes.map((note) => ({ ...note, text: note.text.trim() })).filter((note) => note.text);
  const resume = `${settings.resumePrefix} : ${period.resumeLabel}`;
  const allText = [settings.title, ...lines.map((line) => line.before + line.date + line.after), resume, ...notes.map((n) => `※ ${n.text}`)].join("");

  let assets: [ArrayBuffer, ArrayBuffer, string, string];
  try {
    assets = await Promise.all([loadFont(400, allText), loadFont(800, allText), dataUri(YOGIBO_LOGO_URL), noticeQrSvg(settings.qrUrl)]);
  } catch (error) {
    console.warn("[leave-notice] 이미지 재료(글꼴·QR) 받기 실패", error);
    return Response.json({ error: "이미지를 만들지 못했어요(글꼴을 받지 못했을 수 있어요). 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
  const [regular, bold, logo, qrSvg] = assets;
  const c = NOTICE_COLORS;
  const height = estimateHeight(
    lines.map((line) => line.before + line.date + line.after),
    notes.map((note) => note.text),
  );

  return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            background: "#fff",
            border: `8px solid ${c.border}`,
            padding: "34px 40px 26px",
            fontFamily: "Noto Sans KR",
            color: c.text,
            wordBreak: "keep-all",
          }}
        >
          <div style={{ fontSize: 34, fontWeight: 800, color: c.title }}>{settings.title}</div>
          {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse 안의 그림 */}
          <img src={svgUri(HEADSET_SVG)} width={104} height={104} style={{ margin: "18px 0 12px" }} alt="" />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", fontSize: 22, lineHeight: 1.7 }}>
            {lines.map((line, index) => (
              <div key={index} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center" }}>
                {/* 글자 조각 끝의 빈칸은 그림에서 지워져 날짜에 붙으므로 지워지지 않는 빈칸으로 바꾼다 */}
                {line.before && <span>{line.before.replace(/ $/, " ")}</span>}
                {line.date && <span style={{ fontWeight: 800, color: c.title }}>{line.date}</span>}
                {line.after && <span>{line.after.replace(/^ /, " ")}</span>}
              </div>
            ))}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              width: "100%",
              margin: "20px 0 14px",
              background: c.banner,
              color: "#fff",
              fontSize: 25,
              fontWeight: 800,
              padding: "8px 10px",
            }}
          >
            {resume}
          </div>
          <div style={{ display: "flex", flexDirection: "column", width: "100%", fontSize: 17, lineHeight: 1.5 }}>
            {notes.map((note, index) => (
              <div key={index} style={{ display: "flex", marginTop: 6, color: note.highlight ? c.highlight : c.text }}>
                <span style={{ width: 22, flexShrink: 0 }}>※</span>
                <span style={{ flex: 1 }}>{note.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexGrow: 1, minHeight: 16 }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", width: "100%" }}>
            {qrSvg ? (
              // eslint-disable-next-line @next/next/no-img-element -- ImageResponse 안의 그림
              <img src={svgUri(qrSvg)} width={100} height={100} alt="" />
            ) : (
              <div style={{ display: "flex" }} />
            )}
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- ImageResponse 안의 그림
              <img src={logo} width={86} height={34} alt="" />
            ) : (
              <div style={{ display: "flex", fontSize: 26, fontWeight: 800, color: c.title }}>yogibo</div>
            )}
          </div>
        </div>
      ),
      {
        width: WIDTH,
        height,
        fonts: [
          { name: "Noto Sans KR", data: regular, weight: 400, style: "normal" },
          { name: "Noto Sans KR", data: bold, weight: 800, style: "normal" },
        ],
        // 관리 화면 전용 그림이라 어디에도 저장해 두지 않는다(미리보기도 문구를 고치면 바로 바뀌게).
        headers: { "Content-Disposition": `attachment; filename="leave-notice-${period.start}.png"`, "Cache-Control": "private, no-store" },
      },
    );
}
