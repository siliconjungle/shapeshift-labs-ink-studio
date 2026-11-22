-- Exercise a real REAPER edit and print the resulting stereo on its native clock.
local r = reaper
local config = dofile(assert(os.getenv('INK_REAPER_VERIFY_CONFIG')))
local function verify()
  local project, current = r.EnumProjects(-1, '')
  assert(current == config.project, 'The workstation did not open the Ink handoff')
  local applied = 0
  local pictureSeconds
  for i = 0, r.CountMediaItems(project)-1 do
    local item = r.GetMediaItem(project,i)
    local _, guid = r.GetSetMediaItemInfo_String(item,'GUID','',false)
    if guid == config.dialogue then
      for j = 0, r.CountTakes(item)-1 do
        local take = r.GetTake(item,j)
        local _, address = r.GetSetMediaItemTakeInfo_String(take,'GUID','',false)
        if address == config.adr then r.SetActiveTake(take); applied = applied+1 end
      end
    elseif guid == config.foley then
      local start = r.GetMediaItemInfo_Value(item,'D_POSITION')
      r.SetMediaItemInfo_Value(item,'D_POSITION',start+config.shift/config.rate)
      r.SetEditCurPos2(project,start+config.shift/config.rate,false,false)
      applied = applied+1
    elseif guid == config.picture then
      local source = r.GetMediaItemTake_Source(r.GetActiveTake(item))
      local kind = r.GetMediaSourceType(source,'')
      assert(kind == 'VIDEO', 'Picture did not load as video: ' .. kind)
      pictureSeconds = r.GetMediaSourceLength(source)
    end
  end
  assert(applied == 2, 'The alternate take and Foley item need exact Ink addresses')
  assert(pictureSeconds and math.abs(pictureSeconds*config.rate-config.frames)<2, 'The picture has a different duration: ' .. tostring(pictureSeconds) .. ' vs ' .. tostring(config.frames/config.rate))
  r.UpdateArrange()
  dofile(config.folder .. '/Capture Ink edits.lua')
  local numeric = {
    RENDER_SETTINGS=0, RENDER_BOUNDSFLAG=0, RENDER_CHANNELS=2, RENDER_SRATE=config.rate,
    RENDER_STARTPOS=0, RENDER_ENDPOS=config.frames/config.rate+.010, RENDER_TAILFLAG=0,
    RENDER_DITHER=16, RENDER_NORMALIZE=0, RENDER_ADDTOPROJ=0
  }
  for name, value in pairs(numeric) do r.GetSetProjectInfo(project,name,value,true) end
  local strings = {RENDER_FILE=config.folder,RENDER_PATTERN='reaper-pcm',RENDER_FORMAT='ZXZhdxgAAQ==',RENDER_FORMAT2=''}
  for name, value in pairs(strings) do r.GetSetProjectInfo_String(project,name,value,true) end
  r.Main_OnCommand(42230,0)
  r.Main_SaveProjectEx(project,config.folder .. '/edited.rpp',0)
  local proof = assert(io.open(config.folder .. '/reaper-picture.tmp','w'))
  local pictureRate = r.TimeMap_curFrameRate(project)
  proof:write(r.GetAppVersion(),'\n',string.format('%.17g',pictureSeconds),'\n',string.format('%.17g',pictureRate),'\n')
  proof:close()
  assert(os.rename(config.folder .. '/reaper-picture.tmp',config.folder .. '/reaper-picture.txt'))
end
local ok, message = xpcall(verify, debug.traceback)
if not ok then
  local file = assert(io.open(config.folder .. '/reaper-error.txt','w'))
  file:write(message,'\n')
  file:close()
end
r.Main_OnCommand(40004,0)
