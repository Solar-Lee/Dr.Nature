import type { Metadata } from "next";

export const metadata: Metadata = { title: "會員", description: "Dr.Nature 會員中心：訂單、等級與權益。正式上線後開放。" };

export default function Account() {
  return (
    <>
      <header className="page-head">
        <h1 className="enter">會員</h1>
        <p className="lede enter" style={{ ["--i" as string]: 1 }}>
          登入、訂單、物流狀態、發票、等級與權益，都在這裡。
        </p>
      </header>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="soon">
          <h2 style={{ fontSize: "1.3rem" }}>會員登入</h2>
          <p className="muted">會員功能與購物車將於正式上線時開放。</p>
          <form onSubmit={undefined} aria-disabled="true">
            <label htmlFor="acc-email">Email</label>
            <input id="acc-email" type="email" placeholder="you@example.com" disabled />
            <span className="btn" aria-disabled="true">
              即將開放
            </span>
          </form>
        </div>
      </section>
    </>
  );
}
