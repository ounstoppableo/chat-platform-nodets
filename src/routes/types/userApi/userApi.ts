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