-- Capture stable Ink item and active take addresses from the open REAPER project.
local r = reaper
local function quoted(text)
  return '"' .. text:gsub('[%z\1-\31\\"]', function(char)
    if char == '"' or char == '\\' then return '\\' .. char end
    return string.format('\\u%04x', char:byte())
  end) .. '"'
end
local function number(value) return string.format('%.17g', value) end
local function object(values)
  local rows = {}
  for name, value in pairs(values) do
    rows[#rows+1] = quoted(name) .. ':' .. value
  end
  table.sort(rows)
  return '{' .. table.concat(rows, ',') .. '}'
end
local function array(values) return '[' .. table.concat(values, ',') .. ']' end
local function takeGUID(take)
  local _, guid = r.GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)
  return quoted(guid)
end
local function capture()
  local project, name = r.EnumProjects(-1, '')
  if name == '' then error('Open or save the Ink editorial project before capturing.') end
  local folder = name:match('^(.*[\\/])')
  if not folder then error('Unable to locate the project folder.') end
  local localFolder = folder:gsub('\\','/')
  local items, tracks = {}, {}
  for i = 0, r.CountTracks(project)-1 do
    local track = r.GetTrack(project, i)
    local guid = quoted(r.GetTrackGUID(track))
    local function control(param) return number(r.GetMediaTrackInfo_Value(track, param)) end
    tracks[#tracks+1] = object({guid=guid,gain=control('D_VOL'),pan=control('D_PAN'),
      mute=control('B_MUTE'),polarity=control('B_PHASE'),width=control('D_WIDTH'),solo=control('I_SOLO'),
      fx=number(r.TrackFX_GetCount(track)),envelopes=number(r.CountTrackEnvelopes(track)),
      sends=number(r.GetTrackNumSends(track,0)),faderLaw=control('D_PANLAW'),mainSend=control('B_MAINSEND')})
    for j = 0, r.CountTrackMediaItems(track)-1 do
      local item = r.GetTrackMediaItem(track, j)
      local _, id = r.GetSetMediaItemInfo_String(item, 'GUID', '', false)
      local take = r.GetActiveTake(item)
      if not take then error('A project item has no active take.') end
      local function itemValue(param) return number(r.GetMediaItemInfo_Value(item, param)) end
      local function takeValue(param) return number(r.GetMediaItemTakeInfo_Value(take, param)) end
      local media = r.GetMediaItemTake_Source(take)
      local file = r.GetMediaSourceFileName(media,'')
      local portable = file:gsub('\\','/')
      if portable:sub(1,#localFolder) == localFolder then file = portable:sub(#localFolder+1) end
      local known = {}
      for k = 0, r.CountTakes(item)-1 do known[#known+1] = takeGUID(r.GetTake(item, k)) end
      items[#items+1] = object({guid=quoted(id),track=guid,take=takeGUID(take),takes=array(known),
        file=quoted(file),position=itemValue('D_POSITION'),length=itemValue('D_LENGTH'),
        itemGain=itemValue('D_VOL'),mute=itemValue('B_MUTE'),allTakes=itemValue('B_ALLTAKESPLAY'),
        loop=itemValue('B_LOOPSRC'),fadeIn=itemValue('D_FADEINLEN'),fadeOut=itemValue('D_FADEOUTLEN'),
        autoIn=itemValue('D_FADEINLEN_AUTO'),autoOut=itemValue('D_FADEOUTLEN_AUTO'),offset=takeValue('D_STARTOFFS'),
        rate=takeValue('D_PLAYRATE'),takeGain=takeValue('D_VOL'),pan=takeValue('D_PAN'),pitch=takeValue('D_PITCH'),
        channelMode=takeValue('I_CHANMODE'),fx=number(r.TakeFX_GetCount(take)),envelopes=number(r.CountTakeEnvelopes(take))})
    end
  end
  local result = object({format=quoted('ink-studio/reaper-editorial-capture'),version='1',
    application=quoted(r.GetAppVersion()),project=quoted(name),tracks=array(tracks),items=array(items)})
  local file = folder .. 'reaper-return.json'
  local temporary = file .. '.tmp'
  local handle = assert(io.open(temporary, 'wb'))
  assert(handle:write(result, '\n'))
  assert(handle:close())
  local renamed = os.rename(temporary, file)
  if not renamed then
    assert(os.remove(file))
    assert(os.rename(temporary, file))
  end
  return file
end
local ok, message = pcall(capture)
if not ok then reaper.MB(tostring(message), 'Ink editorial capture', 0)
else reaper.ShowConsoleMsg('Wrote ' .. message .. '\n') end
