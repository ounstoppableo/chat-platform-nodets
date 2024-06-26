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
    isLogin: boolean,
    region: string
}

export interface Group{
    authorBy:string;
    groupName: string;
    groupId: string;
    username: string;
    gavatar: string;
    lastMsg: string;
    time: Date;
    hadNewMsg: boolean;
    lastMsgUser: string;
    type: string;
    fromAvatar: string;
    toAvatar: string;
    toUsername: string;
}

