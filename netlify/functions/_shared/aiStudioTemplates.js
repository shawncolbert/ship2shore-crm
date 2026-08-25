// House visual style for AI Studio-generated landing pages -- the same dark
// navy/aqua/gold "command center" CSS used across every hand-built landing
// page (transport, port-transport, nationwide-transport). Kept as one
// exported constant so the system prompt and any future hand-edits pull
// from a single source of truth instead of drifting between pages.
export const LANDING_PAGE_CSS = `<style>
  :root{
    --navy-deep:#070f1e;
    --navy:#0d1e38;
    --navy-2:#111f3a;
    --navy-3:#162540;
    --aqua:#00d4e0;
    --aqua-dim:#0099a8;
    --gold:#f0b840;
    --amber:#ffb020;
    --white:#f4f7fb;
    --gray:#7f8fa8;
    --line:rgba(255,255,255,.09);
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  .s2s-page{
    background:var(--navy-deep);
    color:var(--white);
    font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    line-height:1.5;
    -webkit-font-smoothing:antialiased;
    overflow-x:hidden;
    min-height:100vh;
  }
  a{color:inherit}
  .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
  header{position:sticky;top:0;z-index:50;background:rgba(7,15,30,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
  .topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;max-width:1120px;margin:0 auto}
  .brand-lockup{display:flex;flex-direction:column;line-height:1}
  .brand-lockup .b1{font-family:'Arial Narrow',Impact,sans-serif;font-size:22px;letter-spacing:2.5px}
  .brand-lockup .b2{font-family:'Courier New',monospace;font-size:9px;letter-spacing:2px;color:var(--amber);margin-top:3px}
  .topbar a.callbtn{font-family:'Courier New',monospace;font-size:12px;letter-spacing:.5px;color:var(--navy-deep);background:var(--aqua);padding:10px 18px;border-radius:2px;text-decoration:none;font-weight:700;white-space:nowrap}
  .hero{position:relative;padding:76px 0 60px;border-bottom:1px solid var(--line)}
  .hero-inner{position:relative;z-index:2;display:grid;grid-template-columns:1.15fr .95fr;gap:56px;align-items:start}
  .eyebrow{font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;color:var(--amber);text-transform:uppercase;margin-bottom:18px;display:flex;align-items:center;gap:10px}
  .eyebrow::before{content:'';width:26px;height:1px;background:var(--amber)}
  h1{font-family:'Arial Narrow',Impact,sans-serif;font-size:clamp(38px,5.4vw,62px);line-height:1.02;letter-spacing:1px;margin-bottom:20px}
  h1 .hi{color:var(--aqua)}
  .hero-sub{font-size:16.5px;color:#c7d2e3;max-width:480px;margin-bottom:30px}
  .proof-row{display:flex;gap:28px;flex-wrap:wrap;margin-top:8px}
  .proof{font-family:'Courier New',monospace;font-size:11px;color:var(--gray);letter-spacing:.5px;display:flex;align-items:center;gap:8px}
  .proof .dot{width:6px;height:6px;border-radius:50%;background:var(--aqua)}
  .quote-card{background:linear-gradient(180deg,var(--navy-2),var(--navy));border:1px solid var(--line);border-radius:6px;padding:28px 26px 24px;box-shadow:0 30px 60px -20px rgba(0,0,0,.6);position:relative}
  .quote-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--aqua),var(--amber),var(--gold));border-radius:6px 6px 0 0}
  .quote-card h2{font-family:'Arial Narrow',Impact,sans-serif;font-size:24px;letter-spacing:1px;margin-bottom:4px}
  .quote-card .sub{font-family:'Courier New',monospace;font-size:10.5px;color:var(--gray);letter-spacing:.5px;margin-bottom:20px}
  .field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
  .field{margin-bottom:10px;position:relative}
  .field label{display:block;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:var(--gray);text-transform:uppercase;margin-bottom:6px}
  .field input, .field select{width:100%;background:var(--navy-deep);border:1px solid var(--line);color:var(--white);padding:11px 12px;border-radius:3px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;outline:none;transition:border-color .15s}
  .field input::placeholder{color:#4d5c78}
  .field input:focus, .field select:focus{border-color:var(--aqua)}
  .field select{appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237f8fa8'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center}
  .mapbox-suggest-list{display:none;position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:2px;max-height:220px;overflow-y:auto;background:var(--navy-2);border:1px solid var(--line);border-radius:3px;box-shadow:0 12px 24px -8px rgba(0,0,0,.6);list-style:none;padding:4px}
  .mapbox-suggest-list li{padding:8px 10px;font-size:13px;color:var(--white);border-radius:2px;cursor:pointer}
  .mapbox-suggest-list li:hover{background:rgba(0,212,224,.12);color:var(--aqua)}
  .submit-btn{width:100%;margin-top:14px;background:var(--amber);color:var(--navy-deep);border:none;padding:14px;border-radius:3px;font-family:'Arial Narrow',Impact,sans-serif;font-size:17px;letter-spacing:2px;cursor:pointer;transition:filter .15s}
  .submit-btn:hover{filter:brightness(1.08)}
  .form-foot{font-family:'Courier New',monospace;font-size:9.5px;color:var(--gray);margin-top:12px;text-align:center;letter-spacing:.3px}
  .section{padding:64px 0;border-bottom:1px solid var(--line)}
  .section-head{margin-bottom:38px}
  .section-label{font-family:'Courier New',monospace;font-size:11px;letter-spacing:3px;color:var(--amber);text-transform:uppercase;margin-bottom:10px}
  .section-title{font-family:'Arial Narrow',Impact,sans-serif;font-size:clamp(28px,4vw,38px);letter-spacing:1px;font-weight:400}
  .steps{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .step{padding:26px 22px;border-right:1px solid var(--line);position:relative}
  .step:last-child{border-right:none}
  .step .num{font-family:'Arial Narrow',Impact,sans-serif;font-size:34px;-webkit-text-stroke:1px var(--aqua);color:transparent;margin-bottom:14px;display:block}
  .step h3{font-family:'Arial Narrow',Impact,sans-serif;font-size:17px;letter-spacing:.5px;margin-bottom:8px;color:var(--white)}
  .step p{font-size:13px;color:var(--gray);line-height:1.5}
  .value-props{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--line);border-radius:6px;overflow:hidden}
  .value-prop{padding:26px 24px;border-right:1px solid var(--line);position:relative}
  .value-prop:last-child{border-right:none}
  .value-prop .mark{width:34px;height:34px;border-radius:50%;border:1.5px solid var(--aqua);display:flex;align-items:center;justify-content:center;margin-bottom:16px;color:var(--aqua);font-family:'Courier New',monospace;font-size:13px;font-weight:700}
  .value-prop h3{font-family:'Arial Narrow',Impact,sans-serif;font-size:17px;letter-spacing:.5px;margin-bottom:8px;color:var(--white)}
  .value-prop p{font-size:13.5px;color:var(--gray);line-height:1.55}
  .coverage{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
  .coverage h2{font-family:'Arial Narrow',Impact,sans-serif;font-size:clamp(26px,3.6vw,34px);letter-spacing:1px;margin-bottom:16px}
  .coverage p{color:#c7d2e3;font-size:14.5px;margin-bottom:14px}
  .fleet-tags{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
  .fleet-tag{font-family:'Courier New',monospace;font-size:11px;letter-spacing:.5px;border:1px solid var(--line);padding:7px 12px;border-radius:20px;color:var(--gray)}
  .side-panel{border:1px solid var(--line);border-radius:6px;background:var(--navy-2);padding:22px 22px 18px}
  .side-panel .sp-head{font-family:'Courier New',monospace;font-size:10px;letter-spacing:2px;color:var(--gray);text-transform:uppercase;margin-bottom:16px}
  .side-row{display:flex;align-items:center;justify-content:space-between;padding:13px 0;border-top:1px solid var(--line)}
  .side-row:first-of-type{border-top:none}
  .side-row .sr-name{font-family:'Arial Narrow',Impact,sans-serif;font-size:16px;letter-spacing:.5px}
  .side-row .sr-status{font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;color:var(--aqua);display:flex;align-items:center;gap:7px}
  .side-row .sr-status .dot{width:6px;height:6px;border-radius:50%;background:var(--aqua)}
  .footer-cta{padding:70px 0;text-align:center}
  .footer-cta h2{font-family:'Arial Narrow',Impact,sans-serif;font-size:clamp(30px,5vw,46px);letter-spacing:1px;margin-bottom:14px}
  .footer-cta p{color:var(--gray);margin-bottom:26px}
  .btn-lg{display:inline-block;background:var(--aqua);color:var(--navy-deep);font-family:'Arial Narrow',Impact,sans-serif;font-size:18px;letter-spacing:2px;padding:16px 40px;border-radius:3px;text-decoration:none}
  footer{border-top:1px solid var(--line);padding:26px 0;text-align:center;font-family:'Courier New',monospace;font-size:11px;color:var(--gray);letter-spacing:.5px}
  footer a{color:var(--aqua);text-decoration:none}
  @media(max-width:860px){
    .hero-inner{grid-template-columns:1fr}
    .field-row{grid-template-columns:1fr}
    .steps{grid-template-columns:1fr 1fr}
    .step{border-bottom:1px solid var(--line)}
    .value-props{grid-template-columns:1fr}
    .value-prop{border-right:none;border-bottom:1px solid var(--line)}
    .value-prop:last-child{border-bottom:none}
    .coverage{grid-template-columns:1fr}
  }
  @media(max-width:520px){
    .steps{grid-template-columns:1fr}
    .topbar a.callbtn{display:none}
  }
</style>`
