export function DisconnectSetting({ turnSeconds, enabled, onChange, disabled = false }: {
  turnSeconds: number;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}) {
  if (turnSeconds !== 0) return null;
  return (
    <div className="disconnect-setting">
      <label>
        <span>不掉线模式</span>
        <select aria-label="不掉线模式" value={String(enabled)} onChange={(event) => onChange(event.target.value === "true")} disabled={disabled}>
          <option value="false">关闭 · 30 秒后电脑接管</option>
          <option value="true">开启 · 离线保留座位</option>
        </select>
      </label>
      <p>{enabled ? "关闭网页或断网仍保留座位和房主权限，轮到离线玩家时等待回来。主动退出仍由电脑接管。" : "断线后保留 30 秒重连时间，超时由电脑接管；房主超时后自动交接权限。"}</p>
    </div>
  );
}
