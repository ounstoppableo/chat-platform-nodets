export interface generalSendMsg {
    type: 'getUserInfo' | 'msg' |'tokenErr' | 'otherErr' | 'getGroupErr' | 'getGroups',
    data: any
}
export interface generalReceiveMsg {
    type: 'login' | 'getGroups',
    data: any
}
export interface userInfo {
    avatar: string,
    groupIds: string[],
    relationship: string[],
    isOnline: boolean
}