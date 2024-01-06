export interface LoginInfo {
    username: string,
    password: string,
    isOnline:boolean,
}
export interface RegisterInfo extends LoginInfo {
 avatar:string,
 uid: string,
 region:string,
}

export interface UserInfo {
    avatar: string,
    uid:string,
    username: string,
    groups: Group[],
    isLogin: boolean
}

export interface Group{
    groupName:  string,
    groupId: string,
    username: string,
    gavatar: string,
    lastMsg: string,
    date: Date
}

