export default function getTodayFinalSec(){
  // 获取当前时间
  const now = new Date();

  // 将时间设置为今天的 24 点
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // 获取结束时间的时间戳（单位：毫秒）
  const endTimeStamp = endOfDay.getTime();

  // 将时间戳转换为秒数
  const endOfDayInSeconds = Math.floor(endTimeStamp / 1000);
  return endOfDayInSeconds;
}