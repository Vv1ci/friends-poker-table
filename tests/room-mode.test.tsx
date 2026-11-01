import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DisconnectSetting } from "../app/disconnect-setting";

test("不限时房间显示两种离线处理规则，选项说明与保存的模式一致", () => {
  for (const enabled of [false, true]) {
    const html = renderToStaticMarkup(<DisconnectSetting turnSeconds={0} enabled={enabled} onChange={() => {}} />);
    assert.match(html, /不掉线模式/);
    assert.match(html, new RegExp(`value="${enabled}" selected=""`));
    assert.match(html, enabled ? /关闭网页或断网仍保留座位和房主权限/ : /超时由电脑接管/);
  }
});

test("限时房间隐藏不掉线选项，忙碌时禁用设置", () => {
  assert.equal(renderToStaticMarkup(<DisconnectSetting turnSeconds={15} enabled onChange={() => {}} />), "");
  assert.match(renderToStaticMarkup(<DisconnectSetting turnSeconds={0} enabled disabled onChange={() => {}} />), /disabled=""/);
});
